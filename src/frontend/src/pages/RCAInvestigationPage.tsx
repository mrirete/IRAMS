import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAssetContext } from '../contexts/AssetContext';
import {
    ArrowLeft, CheckCircle2, Circle, Lock, ChevronRight, ChevronLeft, ChevronDown,
    AlertTriangle, FileText, Search, Shield, Wrench, BarChart3,
    Plus, Trash2, Users, ClipboardList, Clock, Flag, Bot,
    Target, Zap, DollarSign, X, Database, MapPin, Loader2, Check, MoreHorizontal,
    Maximize2, Minimize2
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Drawer, Button, Field, Input, Select, Textarea } from '../eam/components/ui';
import RCAStepGuide from '../components/analyze/RCAStepGuide';
import { getStepCompletion } from '../components/analyze/RCAStepIndicator';
import { friendlyAIError } from '../eam/lib/aiError';
import { analyzeService, scopeNodesToMethod, rcaMethodLabel, rcaMethodColor } from '../eam/services/AnalyzeService';
import { DatabaseService } from '../eam/services/DatabaseService';
import { RaiseWorkModal } from '../eam/components/RaiseWorkModal';
import { ImageGallery } from '../eam/components/ui/ImageGallery';
import CauseAnalysisSection from '../components/analyze/CauseAnalysisSection';
import { RcaChallengerPanel } from '../components/analyze/RcaChallengerPanel';
import { RcaCopilotPanel } from '../components/analyze/RcaCopilotPanel';
import FiveWhySection from '../components/analyze/FiveWhySection';
import RCAMethodGate from '../components/analyze/RCAMethodGate';
import { TeamPanel, AvatarStack } from '../components/analyze/CollaboratorPicker';
import { NotificationService } from '../eam/services/NotificationService';
import { useAuth } from '../eam/contexts/AuthContext';
import { supabase } from '../eam/lib/supabase';
import { aiEngine } from '../eam/services/AIAnalysisEngine';
import type { RCAMethodRecommendation } from '../eam/services/AIAnalysisEngine';
import type {
    RCAInvestigation, RCANode, RCAEvidence, RCACorrectiveAction,
    RCABarrier, RCATeamMember, RCAAuditLog, RCACauseTaxonomy,
    StudyCollaborator,
} from '../eam/services/AnalyzeService';

// ── Step definitions ─────────────────────────────────────────
const STEPS = [
    { num: 1, label: 'Define Problem', icon: FileText, desc: 'Event summary & 3W2H' },
    { num: 2, label: 'Collect Evidence', icon: Search, desc: 'Data, timeline, linked records' },
    { num: 3, label: 'Identify Causes', icon: AlertTriangle, desc: 'Analysis Method, 5-Why, Fishbone, barriers' },
    { num: 4, label: 'Develop Solutions', icon: Wrench, desc: 'Corrective actions plan' },
    { num: 5, label: 'Implement', icon: Shield, desc: 'Track action completion' },
    { num: 6, label: 'Track Effectiveness', icon: BarChart3, desc: 'Verify & close' },
] as const;

const RCA_CATEGORIES = [
    { value: 'safety', label: 'Safety-based', color: '#ef4444' },
    { value: 'production', label: 'Production-based', color: '#f59e0b' },
    { value: 'process', label: 'Process-based', color: '#3b82f6' },
    { value: 'asset_failure', label: 'Asset Failure-based', color: '#8b5cf6' },
];

// The method catalog lives in AnalyzeService (RCA_METHODS / rcaMethodLabel) — it was
// duplicated here, in RCATab and in the step guide, and the three copies had drifted.
// Methods that have a dedicated editor; anything else falls back to the flat cause list.
const VISUAL_DIAGRAM_METHODS = ['five_why', 'fishbone', 'fault_tree', 'logic_tree'];

const CAUSE_CATEGORIES = [
    { value: 'physical', label: 'Physical', color: '#ef4444', desc: 'Tangible component failure' },
    { value: 'human', label: 'Human', color: '#f59e0b', desc: 'Inappropriate action/omission' },
    { value: 'latent', label: 'Latent / Systemic', color: '#8b5cf6', desc: 'Management system deficiency' },
];

const BARRIER_TYPES = [
    { value: 'preventive', label: 'Preventive' },
    { value: 'mitigative', label: 'Mitigative' },
];

const BARRIER_CLASSES = [
    { value: 'technical', label: 'Technical' },
    { value: 'human', label: 'Human' },
    { value: 'organizational', label: 'Organizational' },
];

const BARRIER_ASSESSMENTS = [
    { value: 'effective', label: 'Effective', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { value: 'failed', label: 'Failed', color: 'text-rose-600 bg-rose-50 border-rose-200' },
    { value: 'not_used', label: 'Not Used', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { value: 'non_existent', label: 'Non-existent', color: 'text-slate-500 bg-slate-50 border-slate-200' },
];

const TAXONOMY_BADGES: Record<string, { label: string; color: string; bg: string; border: string }> = {
    site:      { label: 'SITE',    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
    unit:      { label: 'UNIT',    color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
    system:    { label: 'SYSTEM',  color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
    equipment: { label: 'EQUIP',   color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    subunit:   { label: 'SUBUNIT', color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    component: { label: 'COMP',    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    location:  { label: 'LOC',     color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
};

// ── Main Component ───────────────────────────────────────────
export function RCAInvestigationPage() {
    const { investigationId } = useParams<{ investigationId: string }>();
    const navigate = useNavigate();
    const { user, profile } = useAuth() as any;
    const currentUserId = user?.id || profile?.id || 'system';
    const currentUsername = profile?.username || user?.email || 'system';
    const isNew = !investigationId || investigationId === 'new';

    // Core state
    const [inv, setInv] = useState<RCAInvestigation | null>(null);
    const [nodes, setNodes] = useState<RCANode[]>([]);
    const [evidence, setEvidence] = useState<RCAEvidence[]>([]);
    const [actions, setActions] = useState<RCACorrectiveAction[]>([]);
    const [barriers, setBarriers] = useState<RCABarrier[]>([]);
    // Barrier analysis is standard RCA (defense-in-depth) but optional noise for
    // routine failure RCAs — collapsed unless barriers exist or the user opens it.
    const [barriersOpen, setBarriersOpen] = useState<boolean | null>(null);

    // ── RCA Copilot (agentic facilitator) ────────────────────
    const [copilotOpen, setCopilotOpen] = useState(false);

    // ── Raise corrective work (WO / Request) from an action ──
    const [raiseAction, setRaiseAction] = useState<RCACorrectiveAction | null>(null);
    const [rcaFaultTypes, setRcaFaultTypes] = useState<{ id: string; code: string; description: string }[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getDictionaries()
            .then(d => setRcaFaultTypes((d || []).filter((x: any) => x.type === 'FAULT_TYPE' && x.active).map((x: any) => ({ id: x.id, code: x.code, description: x.description }))))
            .catch(() => setRcaFaultTypes([]));
    }, []);
    const [team, setTeam] = useState<RCATeamMember[]>([]);
    const [auditLog, setAuditLog] = useState<RCAAuditLog[]>([]);
    const [taxonomy, setTaxonomy] = useState<RCACauseTaxonomy[]>([]);
    const [relatedRCAs, setRelatedRCAs] = useState<RCAInvestigation[]>([]);

    const [activeStep, setActiveStep] = useState(1);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Collaboration state
    const [showTeamPanel, setShowTeamPanel] = useState(false);
    const [rcaCollaborators, setRcaCollaborators] = useState<StudyCollaborator[]>([]);

    // Toast feedback
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    // Mobile viewport detector for indent dampening
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 640);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // ── DE Task creation from RCA ─────────────────────────────
    const [showDEModal, setShowDEModal] = useState(false);
    const [deCreating, setDeCreating] = useState(false);
    const [deCreated, setDeCreated] = useState(false);
    const [deDraft, setDeDraft] = useState({
        title: '',
        rootCauseSummary: '',
        proposedSolution: '',
        annualCost: 0,
        estimatedSavings: 0,
        implementationCost: 0,
        priority: 'high' as 'critical' | 'high' | 'medium' | 'low',
    });

    // Draft state for new investigations
    const [draft, setDraft] = useState({
        title: '', asset_id: '',
        rca_category: 'asset_failure' as string,
        investigation_type: 'reactive' as string,
        problem_statement: '', event_what: '', event_how: '',
        event_location: '', event_date: '',
        event_how_much: { cost: 0, downtime_hrs: 0, safety_tier: '', env_impact: '' },
    });

    const location = useLocation();
    const { assets: allHierarchyAssets } = useAssetContext();

    // ── EAM Asset search states ──────────────────────────────
    const [newAssetSearch, setNewAssetSearch] = useState('');
    const [showNewAssetDropdown, setShowNewAssetDropdown] = useState(false);

    // ── Asset Context Card state ──────────────────────────────
    const [formAssetDetail, setFormAssetDetail] = useState<any | null>(null);
    const [formAssetTrends, setFormAssetTrends] = useState<{ totalCM: number; totalPM: number; totalCost: number } | null>(null);
    const [formAssetLoading, setFormAssetLoading] = useState(false);

    // ── AI Method Recommendation state ────────────────────────
    const [aiMethodRec, setAiMethodRec] = useState<RCAMethodRecommendation | null>(null);
    const [aiMethodLoading, setAiMethodLoading] = useState(false);
    const [aiMethodError, setAiMethodError] = useState<string | null>(null);

    const hasEAMAssets = allHierarchyAssets.length > 0;

    const hierarchyAssets = useMemo(() => {
        return allHierarchyAssets
            .map(a => ({
                id: a.id, tag: a.tag || '', name: a.name || '',
                taxonomy_level: (a as any).taxonomy_level || 'equipment',
            }))
            .sort((a, b) => {
                const order = ['site', 'unit', 'system', 'equipment', 'subunit', 'component', 'location'];
                return order.indexOf(a.taxonomy_level) - order.indexOf(b.taxonomy_level) || a.tag.localeCompare(b.tag);
            });
    }, [allHierarchyAssets]);

    const filteredHierarchyAssets = useMemo(() => {
        if (!newAssetSearch.trim()) return hierarchyAssets.slice(0, 30);
        const q = newAssetSearch.toLowerCase();
        return hierarchyAssets.filter(a =>
            a.tag.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.taxonomy_level.toLowerCase().includes(q)
        ).slice(0, 30);
    }, [hierarchyAssets, newAssetSearch]);

    // ── Data fetching ────────────────────────────────────────
    const fetchAll = useCallback(async (id: string) => {
        setLoading(true);
        try {
            const [invData, nodesData, evData, actData, barData, teamData, logData, taxData] = await Promise.all([
                analyzeService.getRCAInvestigations().then(list => list.find(r => r.id === id) || null),
                analyzeService.getRCANodes(id),
                analyzeService.getRCAEvidence(id),
                analyzeService.getRCACorrectiveActions(id),
                analyzeService.getRCABarriers(id),
                analyzeService.getRCATeamMembers(id),
                analyzeService.getRCAAuditLog(id),
                analyzeService.getCauseTaxonomy(),
            ]);
            if (invData) {
                setInv(invData);
                setRcaCollaborators(invData.collaborators || []);
                setActiveStep(invData.current_step || 1);
                setDraft(d => ({
                    ...d, title: invData.title, asset_id: invData.asset_id,
                    rca_category: invData.rca_category || 'asset_failure',
                    investigation_type: invData.investigation_type || 'reactive',
                    problem_statement: invData.problem_statement || '',
                    event_what: invData.event_what || '', event_how: invData.event_how || '',
                    event_location: invData.event_location || '',
                    event_date: invData.event_date ? invData.event_date.split('T')[0] : '',
                    event_how_much: (invData.event_how_much as any) || { cost: 0, downtime_hrs: 0, safety_tier: '', env_impact: '' },
                }));
                // Fetch related RCAs for re-occurrence detection
                const related = await analyzeService.getRelatedRCAs(invData.asset_id);
                setRelatedRCAs(related.filter(r => r.id !== id));
            }
            setNodes(nodesData); setEvidence(evData); setActions(actData);
            setBarriers(barData); setTeam(teamData); setAuditLog(logData);
            setTaxonomy(taxData);
        } catch (e) { console.error('Failed to load RCA:', e); }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (!isNew && investigationId) fetchAll(investigationId);
        else {
            analyzeService.getCauseTaxonomy().then(setTaxonomy);
            setLoading(false);
        }
    }, [investigationId, isNew, fetchAll]);

    // ── Collaboration handlers ────────────────────────────────
    const handleAddCollaborator = async (collab: StudyCollaborator) => {
        const updated = [...rcaCollaborators, { ...collab, added_by: currentUsername }];
        setRcaCollaborators(updated);
        if (inv?.id) {
            try {
                await analyzeService.updateRCAInvestigation(inv.id, { collaborators: updated } as any);
                showToast(`${collab.name} added as ${collab.role}`);

                // ── Send in-app notification to the invited user ──
                // Resolve the contact's linked user_id (two strategies)
                if (collab.type === 'contact' && collab.ref_id) {
                    try {
                        // Strategy 1: contact.user_id
                        let recipientUserId: string | null = null;
                        const { data: contact } = await supabase
                            .from('contacts').select('user_id').eq('id', collab.ref_id).maybeSingle();
                        recipientUserId = contact?.user_id || null;

                        // Strategy 2: reverse lookup — users.contact_id → user.id
                        if (!recipientUserId) {
                            const { data: userRow } = await supabase
                                .from('users').select('id').eq('contact_id', collab.ref_id).maybeSingle();
                            recipientUserId = userRow?.id || null;
                        }

                        if (recipientUserId) {
                            await NotificationService.notify({
                                recipientId: recipientUserId,
                                title: '🤝 RCA Team Invitation',
                                message: `You have been invited to collaborate on RCA: "${inv.title}" as ${collab.role}. Click to view the investigation.`,
                                severity: 'INFO',
                                notificationType: 'ASSIGNMENT',
                                module: 'analyze',
                                entityId: inv.id,
                                entityType: 'RCA_INVESTIGATION',
                                entityNumber: inv.title,
                                actionLink: `/analyze/rca/${inv.id}`,
                                actionRequired: collab.role === 'editor' || collab.role === 'owner',
                                createdBy: currentUserId,
                            });
                            console.log(`[RCA] Notification sent to user ${recipientUserId} for RCA collaboration`);
                        } else {
                            console.warn(`[RCA] No user account linked for contact ${collab.ref_id} — notification skipped`);
                        }
                    } catch (notifErr) {
                        console.warn('[RCA] Non-critical: notification dispatch failed', notifErr);
                    }
                }
            } catch (e) {
                console.error('[RCA] Failed to save collaborator:', e);
                showToast('Failed to save collaborator', 'error');
                // Revert optimistic update
                setRcaCollaborators(rcaCollaborators);
            }
        }
    };

    const handleRemoveCollaborator = async (id: string) => {
        const previous = rcaCollaborators;
        const updated = rcaCollaborators.filter(c => c.id !== id);
        setRcaCollaborators(updated);
        if (inv?.id) {
            try {
                await analyzeService.updateRCAInvestigation(inv.id, { collaborators: updated } as any);
                showToast('Team member removed');
            } catch (e) {
                console.error('[RCA] Failed to remove collaborator:', e);
                showToast('Failed to remove team member', 'error');
                setRcaCollaborators(previous);
            }
        }
    };

    const handleUpdateCollaboratorRole = async (id: string, role: any) => {
        const previous = rcaCollaborators;
        const updated = rcaCollaborators.map(c => c.id === id ? { ...c, role } : c);
        setRcaCollaborators(updated);
        if (inv?.id) {
            try {
                await analyzeService.updateRCAInvestigation(inv.id, { collaborators: updated } as any);
            } catch (e) {
                console.error('[RCA] Failed to update collaborator role:', e);
                showToast('Failed to update role', 'error');
                setRcaCollaborators(previous);
            }
        }
    };

    // ── Pre-populate form state from router state (e.g. from bad actors or work orders) ──
    useEffect(() => {
        if (isNew && location.state) {
            const state = location.state as {
                title?: string;
                asset_id?: string;
                description?: string;
                maintenanceData?: any;
            } | null;
            if (state) {
                setDraft(d => {
                    const newHowMuch = { ...d.event_how_much };
                    if (state.maintenanceData) {
                        newHowMuch.cost = state.maintenanceData.totalCost || state.maintenanceData.event_how_much_cost || 0;
                        newHowMuch.downtime_hrs = state.maintenanceData.mttrHours || state.maintenanceData.event_how_much_downtime || 0;
                    }
                    return {
                        ...d,
                        title: state.title || d.title,
                        asset_id: state.asset_id || d.asset_id,
                        problem_statement: state.description || d.problem_statement,
                        event_how_much: newHowMuch,
                        event_date: new Date().toISOString().split('T')[0],
                    };
                });
            }
        }
    }, [isNew, location.state]);

    // ── Load EAM Asset context card when asset changes ──
    useEffect(() => {
        if (!draft.asset_id) {
            setFormAssetDetail(null);
            setFormAssetTrends(null);
            return;
        }
        let cancelled = false;
        setFormAssetLoading(true);
        Promise.all([
            analyzeService.getAssetDetail(draft.asset_id),
            analyzeService.getFailureTrends(draft.asset_id),
        ]).then(([detail, trends]) => {
            if (cancelled) return;
            setFormAssetDetail(detail);
            setFormAssetTrends({
                totalCM: trends?.totalCM || 0,
                totalPM: trends?.totalPM || 0,
                totalCost: trends?.totalCost || 0,
            });
            // Auto-fill event_location with functional location breadcrumb
            if (detail && detail.breadcrumb && detail.breadcrumb.length > 0) {
                const locStr = detail.breadcrumb.map((b: any) => b.name || b.tag).join(' › ');
                setDraft(d => ({ ...d, event_location: d.event_location || locStr }));
            }
        }).catch(err => console.error('Error loading asset context:', err))
          .finally(() => { if (!cancelled) setFormAssetLoading(false); });
        return () => { cancelled = true; };
    }, [draft.asset_id]);

    // ── Save / Create ────────────────────────────────────────
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            if (isNew) {
                const created = await analyzeService.createRCAInvestigation({
                    asset_id: draft.asset_id || '00000000-0000-0000-0000-000000000000',
                    title: draft.title || 'Untitled Investigation',
                    // No method at creation. It is chosen at the step-3 gate, once the
                    // evidence is in — picking one here would be picking before looking.
                    method: null, status: 'draft',
                    problem_statement: draft.problem_statement,
                    root_cause_summary: null,
                    rca_category: draft.rca_category as any,
                    investigation_type: draft.investigation_type as any,
                    trigger_type: 'manual', trigger_reference_id: null,
                    event_date: draft.event_date || null,
                    event_location: draft.event_location || null,
                    event_what: draft.event_what || null,
                    event_how: draft.event_how || null,
                    event_how_much: draft.event_how_much as any,
                    work_order_id: (location.state as any)?.incomingWO?.wo_id || null, lead_investigator: null,
                    current_step: 1, closed_at: null,
                    effectiveness_due: null, effectiveness_status: 'pending',
                    previous_rca_id: null,
                });
                if (created) {
                    navigate(`/analyze/rca/${created.id}`, { replace: true });
                } else {
                    showToast('Could not save the investigation — please try again (check the console for details).', 'error');
                }
            } else if (inv) {
                await analyzeService.updateRCAInvestigation(inv.id, {
                    title: draft.title, problem_statement: draft.problem_statement,
                    // `method` is deliberately absent: it is owned by the step-3 gate.
                    // Writing it from this draft reverted a committed method back to the
                    // stale value the draft was loaded with every time step 1 was saved.
                    rca_category: draft.rca_category as any,
                    investigation_type: draft.investigation_type as any,
                    event_date: draft.event_date || null,
                    event_location: draft.event_location || null,
                    event_what: draft.event_what || null,
                    event_how: draft.event_how || null,
                    event_how_much: draft.event_how_much as any,
                    current_step: activeStep,
                } as any);
                await fetchAll(inv.id);
            }
        } catch (e) { console.error('Save error:', e); }
        setSaving(false);
    }, [isNew, draft, inv, activeStep, navigate, fetchAll]);

    // ── Step navigation ──────────────────────────────────────
    const goStep = (step: number) => {
        if (step >= 1 && step <= 6) setActiveStep(step);
    };

    // ── AI method advisor (compact corner button) ────────────
    const runMethodAdvisor = useCallback(async () => {
        if (!inv) return;
        setAiMethodLoading(true);
        setAiMethodRec(null);
        setAiMethodError(null);
        try {
            const result = await aiEngine.recommendRCAMethod({
                problemDescription: inv.problem_statement || inv.title || '',
                assetCriticality: formAssetDetail?.criticality || undefined,
                rcaCategory: inv.rca_category || 'asset_failure',
                investigationType: inv.investigation_type || 'reactive',
                triggerType: inv.trigger_type || 'manual',
                failureCount: formAssetTrends ? (formAssetTrends.totalCM + formAssetTrends.totalPM) : undefined,
                totalCost: formAssetTrends?.totalCost || undefined,
            });
            if ((result as any)?.error) {
                console.error('[AI Method Advisor]', (result as any).error);
                setAiMethodError(friendlyAIError((result as any).error));
            } else {
                setAiMethodRec(result);
            }
        } catch (err: any) {
            console.error('[AI Method Advisor]', err);
            setAiMethodError(friendlyAIError(err));
        }
        setAiMethodLoading(false);
    }, [inv, formAssetDetail, formAssetTrends]);

    // ── Open DE Task modal (auto-populate from RCA data) ─────
    const openDEModal = useCallback(() => {
        // Build root cause summary from the committed method's nodes only — causes left
        // behind by an abandoned method are not this investigation's conclusion.
        const own = scopeNodesToMethod(nodes, inv?.method);
        const rootCauseNodes = own.filter(n => n.is_root_cause || n.node_type === 'root_cause');
        const whyNodes = own.filter(n => n.node_type === 'why').sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
        const allCauseNodes = rootCauseNodes.length > 0 ? rootCauseNodes : whyNodes;

        const methodLabel = rcaMethodLabel(inv?.method);

        const rootCauseSummary = allCauseNodes.length > 0
            ? `${methodLabel}: ${allCauseNodes.map(n => n.description).join(' → ')}`
            : inv?.root_cause_summary || draft.problem_statement || '';

        // Build proposed solution from corrective actions
        const proposedSolution = actions.length > 0
            ? actions.map((a, i) => `${i + 1}. ${a.action_description}${a.assigned_to ? ` (${a.assigned_to})` : ''}${a.status === 'completed' ? ' ✅' : ''}`).join('\n')
            : '';

        // Estimate cost from event_how_much
        const howMuch = (inv?.event_how_much as any) || draft.event_how_much;
        const annualCost = Number(howMuch?.cost || 0);

        setDeDraft({
            title: `Defect Elimination: ${inv?.title || draft.title}`,
            rootCauseSummary,
            proposedSolution,
            annualCost,
            estimatedSavings: Math.round(annualCost * 0.75),
            implementationCost: 0,
            priority: annualCost > 100000 ? 'critical' : annualCost > 50000 ? 'high' : 'medium',
        });
        setShowDEModal(true);
    }, [inv, draft, nodes, actions]);

    const handleCreateDETask = useCallback(async () => {
        setDeCreating(true);
        try {
            const assetId = inv?.asset_id || draft.asset_id || null;
            // Try to get asset name from the investigation title
            const assetName = inv?.title?.split('—')[1]?.trim() || inv?.title?.split('-')[1]?.trim() || inv?.title || draft.title || 'Unknown';
            const payback = deDraft.estimatedSavings > 0 && deDraft.implementationCost > 0
                ? Math.ceil(deDraft.implementationCost / (deDraft.estimatedSavings / 12))
                : 0;

            const result = await analyzeService.createDETask({
                asset_id: assetId,
                asset_name: assetName,
                title: deDraft.title,
                status: 'identified',
                priority: deDraft.priority,
                annual_cost: deDraft.annualCost,
                estimated_savings: deDraft.estimatedSavings,
                implementation_cost: deDraft.implementationCost,
                payback_months: payback,
                root_cause_summary: deDraft.rootCauseSummary,
                proposed_solution: deDraft.proposedSolution,
                rca_id: inv?.id || null,
                created_by: null,
            });

            // Dispatch DE task created notification
            if (result && profile?.id) {
                NotificationService.notifyDETaskCreated({
                    taskId: (result as any).id || '',
                    taskTitle: deDraft.title,
                    assetName,
                    priority: deDraft.priority,
                    source: 'rca',
                    recipientId: profile.id,
                    createdBy: profile.id,
                }).catch(console.error);
            }

            setDeCreated(true);
            setTimeout(() => { setShowDEModal(false); setDeCreated(false); }, 2000);
        } catch (e) {
            console.error('Failed to create DE task:', e);
        }
        setDeCreating(false);
    }, [inv, draft, deDraft, profile]);

    // ── Node management ──────────────────────────────────────
    const [newNodeDesc, setNewNodeDesc] = useState('');
    const [newNodeType, setNewNodeType] = useState<string>('why');
    const [newNodeCauseCategory, setNewNodeCauseCategory] = useState<string>('');
    const [newNodeCauseCode, setNewNodeCauseCode] = useState<string>('');

    const addNode = async () => {
        if (!inv || !newNodeDesc.trim()) return;
        const node = await analyzeService.createRCANode({
            investigation_id: inv.id, parent_id: null,
            node_type: newNodeType as any, description: newNodeDesc.trim(),
            depth: newNodeType === 'problem' ? 0 : nodes.length,
            is_root_cause: newNodeType === 'root_cause',
            cause_category: (newNodeCauseCategory || null) as any,
            cause_code: newNodeCauseCode || null, evidence_notes: null,
        });
        if (node) { setNodes(n => [...n, node]); setNewNodeDesc(''); }
    };

    // ── Evidence management ──────────────────────────────────
    const [newEvTitle, setNewEvTitle] = useState('');
    const [newEvContent, setNewEvContent] = useState('');
    const [newEvType, setNewEvType] = useState<string>('note');

    const addEvidence = async () => {
        if (!inv || !newEvTitle.trim()) return;
        const ev = await analyzeService.addRCAEvidence({
            investigation_id: inv.id, evidence_type: newEvType as any,
            title: newEvTitle.trim(), content: newEvContent || null,
            linked_entity_id: null, event_timestamp: null, uploaded_by: null,
        });
        if (ev) { setEvidence(e => [...e, ev]); setNewEvTitle(''); setNewEvContent(''); setAddEvidenceOpen(false); }
    };

    // ── Corrective Action management ─────────────────────────
    // Add-forms live in sheets, not stacked open at the bottom of each step.
    const [addEvidenceOpen, setAddEvidenceOpen] = useState(false);
    const [addActionOpen, setAddActionOpen] = useState(false);

    // Scroll target for "Change method" — the 5-Why escalation hint sits far below the gate.
    const methodGateRef = useRef<HTMLDivElement>(null);

    // The cause tool opens as a full-screen workspace (all four methods).
    const [causeFullscreen, setCauseFullscreen] = useState(false);
    // Esc closes it; and don't let the page behind scroll while it's open.
    useEffect(() => {
        if (!causeFullscreen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCauseFullscreen(false); };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [causeFullscreen]);

    // Header overflow menu (team / DE task / report)
    const [invMenuOpen, setInvMenuOpen] = useState(false);
    const invMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!invMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (invMenuRef.current && !invMenuRef.current.contains(e.target as Node)) setInvMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [invMenuOpen]);

    const [newActionDesc, setNewActionDesc] = useState('');
    const [newActionType, setNewActionType] = useState<string>('short_term');
    const [newActionCategory, setNewActionCategory] = useState<string>('physical');
    const [newActionAssignee, setNewActionAssignee] = useState('');
    const [newActionDue, setNewActionDue] = useState('');

    const addAction = async () => {
        if (!inv || !newActionDesc.trim()) return;
        const act = await analyzeService.addRCACorrectiveAction({
            investigation_id: inv.id, cause_node_id: null,
            cause_category: newActionCategory as any,
            action_description: newActionDesc.trim(),
            action_type: newActionType as any,
            assigned_to: newActionAssignee || null,
            due_date: newActionDue || null, status: 'open',
            requires_moc: false, completion_date: null,
            completion_notes: null, risk_of_not_acting: null,
            work_order_id: null,
        });
        if (act) {
            setActions(a => [...a, act]);
            setNewActionDesc(''); setNewActionAssignee(''); setNewActionDue('');
            setAddActionOpen(false);
        }
    };

    // ── Barrier management ───────────────────────────────────
    const [newBarrierDesc, setNewBarrierDesc] = useState('');
    const [newBarrierType, setNewBarrierType] = useState<string>('preventive');
    const [newBarrierClass, setNewBarrierClass] = useState<string>('technical');
    const [newBarrierAssessment, setNewBarrierAssessment] = useState<string>('failed');

    const addBarrier = async () => {
        if (!inv || !newBarrierDesc.trim()) return;
        const bar = await analyzeService.addRCABarrier({
            investigation_id: inv.id, barrier_type: newBarrierType as any,
            barrier_class: newBarrierClass as any, description: newBarrierDesc.trim(),
            assessment: newBarrierAssessment as any, failure_reason: null,
            corrective_action_id: null,
        });
        if (bar) { setBarriers(b => [...b, bar]); setNewBarrierDesc(''); }
    };

    // ── Team management ──────────────────────────────────────
    const [newMemberName, setNewMemberName] = useState('');
    const [newMemberRole, setNewMemberRole] = useState<string>('investigator');

    const addTeamMember = async () => {
        if (!inv || !newMemberName.trim()) return;
        const mem = await analyzeService.addRCATeamMember({
            investigation_id: inv.id, contact_id: null,
            member_name: newMemberName.trim(), role: newMemberRole as any,
        });
        if (mem) { setTeam(t => [...t, mem]); setNewMemberName(''); }
    };

    // ── Step completion — derived from the WORK, not from a counter ────────────
    // This used to be `(inv?.current_step || 1) > st.num`, where current_step was
    // written by handleSave as the step you were LEAVING. So a step never ticked
    // until you had moved two steps past it — the checkmarks permanently lagged
    // reality, and clicking straight to step 6 "completed" nothing.
    // A step is done when its work exists. getStepCompletion already encoded exactly
    // this; it was only ever called from unreachable code.
    // NOTE: must stay above the `if (loading)` early return — it's a hook.
    const stepDone = useMemo(() => getStepCompletion({
        hasProblemStatement: !!(inv?.problem_statement || draft.problem_statement || '').trim(),
        has5W2H: [
            draft.event_what, draft.event_how, draft.event_location, draft.event_date,
            (draft.event_how_much?.cost || draft.event_how_much?.downtime_hrs) ? 'x' : '',
        ].filter(v => !!v && String(v).trim()).length >= 2,
        evidenceCount: evidence.length,
        hasRootCause: scopeNodesToMethod(nodes, inv?.method)
            .some(n => n.is_root_cause || n.node_type === 'root_cause'),
        actionCount: actions.length,
        allActionsAssigned: actions.length > 0 && actions.every(a => !!a.assigned_to),
        effectivenessReviewed: !!inv?.effectiveness_status && inv.effectiveness_status !== 'pending',
    }), [inv, draft, evidence.length, nodes, actions]);

    if (loading) {
        return (
            <div className="bg-slate-50 min-h-screen p-6 md:p-8 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    <p className="text-sm font-medium animate-pulse">Loading investigation details…</p>
                </div>
            </div>
        );
    }

    // ── Method scoping ───────────────────────────────────────
    // The step-3 editors must only ever see the nodes their own method authored.
    // Passing the raw investigation-wide array is what let a fishbone's 6M category
    // rows resurface inside the fault tree as intermediate gate events.
    const methodCommitted = !!inv?.method_locked_at && !!inv?.method;
    const scopedNodes = scopeNodesToMethod(nodes, inv?.method);

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="bg-slate-50/50 min-h-screen text-slate-800 antialiased p-4 sm:p-6 md:p-8 animate-in fade-in duration-300">
            {/* Toast notification */}
            {toast && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-lg border text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top duration-300 ${
                    toast.type === 'success'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}>
                    {toast.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {toast.message}
                </div>
            )}
            <div className="max-w-7xl mx-auto space-y-6">
                
                {/* Header — sticks to the top. An RCA is a team exercise and the page is long;
                    Invite has to be reachable from wherever you are in it, not just from the
                    top of a six-step scroll. */}
                <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 pt-1 pb-4 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200/80
                                flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex flex-col gap-2">
                        {/* Breadcrumb, not a single back-step: an investigation is two levels
                            deep, so the main menu (Reliability) has to be one click away — not
                            a back-button chain the user has to discover. */}
                        <nav className="flex items-center gap-1.5 text-xs font-bold w-fit" aria-label="Breadcrumb">
                            <button
                                className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                                onClick={() => navigate('/reliability')}
                            >
                                <ArrowLeft size={14} strokeWidth={2.5} /> Reliability
                            </button>
                            <span className="text-slate-300">/</span>
                            <button
                                className="text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                                onClick={() => navigate('/analyze')}
                            >
                                Analyze
                            </button>
                        </nav>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                                {isNew ? 'New RCA Investigation' : (inv?.title || 'Investigation')}
                            </h1>
                            <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border tracking-wide uppercase ${
                                inv?.status === 'closed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                inv?.status === 'review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                                {inv?.status?.toUpperCase() || 'DRAFT'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap">
                        {/* Invite stays a first-class button — an RCA is collaborative, and burying
                            "get the people who were there into this" behind ⋯ was a mistake.
                            DE task and Report stay in the menu: you do those once, at the end. */}
                        {!isNew && (
                            <>
                                {rcaCollaborators.length > 0 && (
                                    <AvatarStack collaborators={rcaCollaborators} max={3} size="md" />
                                )}
                                <button
                                    onClick={() => setShowTeamPanel(true)}
                                    className="px-3.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                                >
                                    <Users size={14} strokeWidth={2.5} />
                                    {rcaCollaborators.length > 0 ? `Team (${rcaCollaborators.length})` : 'Invite'}
                                </button>
                                <div className="relative shrink-0" ref={invMenuRef}>
                                    <button
                                        onClick={() => setInvMenuOpen(o => !o)}
                                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                        aria-label="More actions"
                                        aria-expanded={invMenuOpen}
                                    >
                                        <MoreHorizontal size={18} />
                                    </button>
                                    {invMenuOpen && (
                                        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden py-1">
                                            <button
                                                onClick={() => { setInvMenuOpen(false); openDEModal(); }}
                                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                                            >
                                                <Target size={15} className="text-slate-400 shrink-0" />
                                                Create DE task
                                            </button>
                                            {/* The printable ISO report has always existed at this route.
                                                Nothing in the UI linked to it. */}
                                            <button
                                                onClick={() => { setInvMenuOpen(false); navigate(`/analyze/rca/${inv?.id}/report`); }}
                                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                                            >
                                                <FileText size={15} className="text-slate-400 shrink-0" />
                                                View RCA report
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                        <button 
                            className="px-4.5 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                            onClick={handleSave} 
                            disabled={saving}
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                                </>
                            ) : 'Save'}
                        </button>
                    </div>
                </div>

                {/* Re-occurrence Alert Banner */}
                {relatedRCAs.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200/80 text-amber-800 p-4 rounded-xl flex items-start gap-3 shadow-sm text-xs sm:text-sm animate-in slide-in-from-top duration-300">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <strong className="font-bold text-amber-900 block mb-0.5">Re-occurrence Warning</strong>
                            This asset has {relatedRCAs.length} prior RCA investigation(s). 
                            Most recent: <span className="font-semibold italic">"{relatedRCAs[0]?.title}"</span> ({relatedRCAs[0]?.status})
                        </div>
                    </div>
                )}

                {/* Stepper Indicator */}
                <div className="bg-white border border-slate-200/80 rounded-xl p-1.5 shadow-sm flex items-center gap-1 overflow-x-auto scrollbar-hide scroll-fade-right">
                    {STEPS.map(st => {
                        const done = stepDone[st.num - 1];
                        const active = activeStep === st.num;
                        const Icon = st.icon;

                        return (
                            <button 
                                key={st.num} 
                                onClick={() => goStep(st.num)}
                                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg border text-xs font-bold transition-all cursor-pointer shrink-0 ${
                                    active 
                                        ? 'border-blue-200/60 bg-blue-50/50 text-blue-700' 
                                        : done 
                                            ? 'border-transparent text-emerald-600 hover:text-emerald-700 hover:bg-slate-50/50' 
                                            : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50/80'
                                }`}
                            >
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                                    done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
                                }`}>
                                    {done ? <Check size={11} strokeWidth={3} /> : st.num}
                                </div>
                                <div className="text-left">
                                    <span className="block leading-none">{st.label}</span>
                                    <span className="hidden sm:block text-[9px] font-normal text-slate-400/80 mt-0.5">{st.desc}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* What this step is for, what good looks like, and what to check off.
                    This content has existed since the module was written (RCAStepGuide) but
                    was only ever mounted inside RCATab's unreachable workspace — the app
                    shipped a six-step curriculum to nobody. It leads every step now. */}
                <RCAStepGuide activeStep={activeStep - 1} />

                {/* ── STEP 1: Define Problem ─────────────────────────── */}
                {activeStep === 1 && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-blue-600" /> Problem Definition & 3W2H
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Investigation Title *</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        value={draft.title} 
                                        onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} 
                                        placeholder="e.g. Premature Seal Failure — PMP-411" 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">RCA Category</label>
                                    <select 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                        value={draft.rca_category} 
                                        onChange={e => setDraft(d => ({ ...d, rca_category: e.target.value }))}
                                    >
                                        {RCA_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Investigation Type</label>
                                    <select 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                        value={draft.investigation_type} 
                                        onChange={e => setDraft(d => ({ ...d, investigation_type: e.target.value }))}
                                    >
                                        <option value="reactive">Reactive (post-failure)</option>
                                        <option value="proactive">Proactive (near-miss / risk-based)</option>
                                    </select>
                                </div>
                                <div />
                            </div>

                            <div className="mb-5">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Problem Statement (What happened?) *</label>
                                <textarea 
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm min-h-[90px] resize-y"
                                    value={draft.problem_statement} 
                                    onChange={e => setDraft(d => ({ ...d, problem_statement: e.target.value }))} 
                                    placeholder="Describe the failure event, symptoms, and sequence of events…" 
                                />
                            </div>

                            {/* EAM Asset register integration */}
                            {hasEAMAssets && (
                                <div className="mb-5">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Linked EAM Asset</label>
                                    {draft.asset_id ? (
                                        <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                                            <Database size={16} className="text-blue-600 shrink-0" />
                                            {(() => {
                                                const sel = allHierarchyAssets.find(a => a.id === draft.asset_id);
                                                return sel ? (
                                                    <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm text-slate-900 font-bold">{sel.tag}</span>
                                                        <span className="text-xs text-slate-500 truncate">— {sel.name}</span>
                                                    </div>
                                                ) : <span className="text-sm text-slate-400">Unknown asset</span>;
                                            })()}
                                            <button 
                                                onClick={() => {
                                                    setDraft(d => ({ ...d, asset_id: '', event_location: '', event_what: '' }));
                                                    setFormAssetDetail(null);
                                                    setFormAssetTrends(null);
                                                    setShowNewAssetDropdown(true);
                                                }}
                                                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer shrink-0 ml-auto"
                                            >
                                                <X size={15} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input 
                                                value={newAssetSearch}
                                                onChange={e => { setNewAssetSearch(e.target.value); setShowNewAssetDropdown(true); }}
                                                onFocus={() => setShowNewAssetDropdown(true)}
                                                placeholder="Search asset register by tag, name, or level…"
                                                className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                            />
                                            {showNewAssetDropdown && (
                                                <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto border-t border-slate-100">
                                                    {filteredHierarchyAssets.length === 0 && (
                                                        <div className="p-4 text-center text-xs text-slate-400 font-medium">No assets found</div>
                                                    )}
                                                    {filteredHierarchyAssets.map(a => {
                                                        const badge = TAXONOMY_BADGES[a.taxonomy_level] || TAXONOMY_BADGES.equipment;
                                                        return (
                                                            <button 
                                                                key={a.id}
                                                                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left cursor-pointer border-b border-slate-100/60 last:border-0"
                                                                onClick={() => {
                                                                    setDraft(d => ({ ...d, asset_id: a.id, event_what: a.tag }));
                                                                    setShowNewAssetDropdown(false);
                                                                    setNewAssetSearch('');
                                                                }}
                                                            >
                                                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${badge.bg} ${badge.color} ${badge.border}`}>{badge.label}</span>
                                                                <span className="text-xs text-slate-900 font-bold shrink-0">{a.tag}</span>
                                                                <span className="text-xs text-slate-500 truncate">— {a.name}</span>
                                                            </button>
                                                        );
                                                    })}
                                                    {filteredHierarchyAssets.length >= 30 && (
                                                        <div className="p-2.5 text-center text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50 font-semibold">Showing first 30 — type to narrow search</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* EAM Asset Context Card */}
                                    {formAssetLoading ? (
                                        <div className="flex items-center gap-2 p-4 text-xs font-semibold text-slate-500">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> Loading asset context...
                                        </div>
                                    ) : formAssetDetail ? (
                                        <div className="mt-3 bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-3">
                                            {/* Breadcrumb */}
                                            {formAssetDetail.breadcrumb?.length > 0 && (
                                                <div className="flex items-center gap-1.5 flex-wrap text-xs font-semibold text-slate-500">
                                                    <MapPin size={12} className="text-blue-600 shrink-0" />
                                                    {formAssetDetail.breadcrumb.map((crumb: any, i: number) => (
                                                        <React.Fragment key={i}>
                                                            {i > 0 && <ChevronRight size={10} className="text-slate-300" />}
                                                            <span className={i === formAssetDetail!.breadcrumb.length - 1 ? 'text-slate-800 font-bold' : ''}>
                                                                {crumb.name || crumb.tag}
                                                            </span>
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                            )}
                                            {/* Identity row */}
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {(() => {
                                                    const cc = (formAssetDetail.criticality || 'C').toUpperCase();
                                                    const ccStyle = cc === 'A' ? 'bg-red-50 text-red-700 border-red-200' : cc === 'B' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200';
                                                    const label = cc === 'A' ? 'Safety Critical' : cc === 'B' ? 'Production Critical' : cc === 'C' ? 'Standard' : 'Low';
                                                    return (
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border text-[10px] font-extrabold ${ccStyle}`}>
                                                            <Shield size={10} strokeWidth={2.5} /> {cc} — {label}
                                                        </span>
                                                    );
                                                })()}
                                                <span className="text-xs text-slate-700 font-medium">
                                                    {formAssetDetail.equipment_type || 'Equipment'}
                                                    {formAssetDetail.manufacturer ? ` │ ${formAssetDetail.manufacturer}` : ''}
                                                    {formAssetDetail.model ? ` │ ${formAssetDetail.model}` : ''}
                                                </span>
                                            </div>
                                            {/* Quick KPIs */}
                                            {formAssetTrends && (
                                                <div className="flex items-center gap-3 text-xs text-slate-600 bg-white border border-slate-200/60 p-2.5 rounded-lg w-fit shadow-xs">
                                                    <span className="flex items-center gap-1 font-medium">
                                                        <Wrench size={12} className="text-slate-400" /> {formAssetTrends.totalCM + formAssetTrends.totalPM} WOs
                                                        <span className="text-rose-600 font-semibold">({formAssetTrends.totalCM} CM)</span>
                                                    </span>
                                                    {formAssetTrends.totalCost > 0 && (
                                                        <>
                                                            <span className="text-slate-200">│</span>
                                                            <span className="font-semibold text-slate-700">
                                                                ${formAssetTrends.totalCost >= 1e3 ? `${(formAssetTrends.totalCost / 1e3).toFixed(1)}K` : formAssetTrends.totalCost.toFixed(0)} cost (12mo)
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Event Date</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        type="date" 
                                        value={draft.event_date} 
                                        onChange={e => setDraft(d => ({ ...d, event_date: e.target.value }))} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Event Location / Functional Path</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        value={draft.event_location} 
                                        onChange={e => setDraft(d => ({ ...d, event_location: e.target.value }))} 
                                        placeholder="e.g. Site A › Unit 1 › System A" 
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 3W2H Details */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                                <Search className="w-4 h-4 text-blue-600" /> 3W2H Causal Assessment (Event Details)
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">What component failed? (What)</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        value={draft.event_what} 
                                        onChange={e => setDraft(d => ({ ...d, event_what: e.target.value }))} 
                                        placeholder="e.g. Pump Mechanical Seal Carbon Face" 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">How did it fail? (How)</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        value={draft.event_how} 
                                        onChange={e => setDraft(d => ({ ...d, event_how: e.target.value }))} 
                                        placeholder="e.g. Heavy thermal cracking and chipping along face" 
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Downtime (Hours)</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        type="number" 
                                        value={draft.event_how_much.downtime_hrs || ''} 
                                        onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, downtime_hrs: Number(e.target.value) } }))} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Estimated Cost ($)</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        type="number" 
                                        value={draft.event_how_much.cost || ''} 
                                        onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, cost: Number(e.target.value) } }))} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Safety Tier Impact</label>
                                    <select 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                        value={draft.event_how_much.safety_tier || ''} 
                                        onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, safety_tier: e.target.value } }))}
                                    >
                                        <option value="">None</option>
                                        <option value="tier_1">Tier 1 Process Safety Event (PSE)</option>
                                        <option value="tier_2">Tier 2 Process Safety Event (PSE)</option>
                                        <option value="lti">Lost Time Injury (LTI)</option>
                                        <option value="first_aid">First Aid Case</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Environmental Impact</label>
                                    <select 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                        value={draft.event_how_much.env_impact || ''} 
                                        onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, env_impact: e.target.value } }))}
                                    >
                                        <option value="">None</option>
                                        <option value="major">Major (uncontained spill)</option>
                                        <option value="minor">Minor (contained release)</option>
                                        <option value="permit_deviation">Regulatory Permit Deviation</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 2: Collect Evidence ─────────────────────── */}
                {activeStep === 2 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <Database className="w-4 h-4 text-blue-600" /> Evidence Library & Data Log
                            </div>
                            
                            <div className="space-y-2">
                                {evidence.map(ev => (
                                    <div key={ev.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-all">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 tracking-wide uppercase">{ev.evidence_type}</span>
                                            <span className="text-sm text-slate-800 font-bold">{ev.title}</span>
                                            {ev.content && <span className="text-xs text-slate-500 font-medium">— {ev.content}</span>}
                                        </div>
                                        <button 
                                            onClick={async () => { await analyzeService.deleteRCAEvidence(ev.id); setEvidence(es => es.filter(x => x.id !== ev.id)); }}
                                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-100 rounded-lg transition-colors cursor-pointer shrink-0 ml-auto sm:ml-0 min-w-[32px] min-h-[32px] flex items-center justify-center"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                {evidence.length === 0 && (
                                    <div className="py-8 text-center text-slate-400 font-medium text-xs">
                                        Nothing collected yet. Start with the failure scene, the work-order history,
                                        and what the operators saw.
                                    </div>
                                )}
                            </div>

                            {/* The add-form used to sit open at the bottom of the step: a 3-field row
                                that stacked into a full column on mobile, so you scrolled past every
                                record you already had to reach it. It's a sheet now. */}
                            <button
                                onClick={() => setAddEvidenceOpen(true)}
                                className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50 font-bold text-xs transition-colors"
                            >
                                <Plus size={14} strokeWidth={2.5} /> Add evidence
                            </button>
                        </div>

                        {/* Photo Evidence Gallery */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3 mb-4">📷 Photo Evidence Gallery</div>
                            <p className="text-xs text-slate-400 font-medium mb-4">
                                Capture or upload photos of the failure, defect, or scene for analysis.
                            </p>
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                                <ImageGallery
                                    entityId={inv.id}
                                    entityType="RCA_INVESTIGATION"
                                    bucket="assets"
                                    prefix="rca_"
                                    readonly={inv.status === 'closed'}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 3: Identify Causes ──────────────────────── */}
                {activeStep === 3 && inv && (
                    <div className="space-y-6">
                        {/* Method commitment gate — one investigation, one method, one editor.
                            This used to be a free-browse toolbox: four buttons that each swapped
                            the editor without touching the nodes the previous one had written, so
                            the tools silently re-interpreted each other's work. */}
                        <div ref={methodGateRef} className="scroll-mt-4">
                        <RCAMethodGate
                            investigation={inv}
                            nodes={nodes}
                            onCommitted={setInv}
                            advisorSlot={
                                <button
                                    onClick={runMethodAdvisor}
                                    disabled={aiMethodLoading}
                                    title="AI recommends the best RCA method from the problem context, asset criticality and failure history. Advisory only — you decide."
                                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-blue-200 bg-white text-blue-600 hover:bg-blue-50 hover:border-blue-300 shadow-xs transition-all disabled:opacity-60"
                                >
                                    {aiMethodLoading ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                    {aiMethodLoading ? 'Analyzing…' : 'Ask AI'}
                                </button>
                            }
                        />
                        </div>

                        {/* AI advisor output — advisory only; "Apply" pre-selects the gate,
                            it does not commit the method on the user's behalf. */}
                        {aiMethodError && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                                <span className="font-bold">AI assistant unavailable — </span>
                                {aiMethodError}
                                <button onClick={() => setAiMethodError(null)} className="ml-2 text-amber-600 hover:text-amber-800 underline">Dismiss</button>
                            </div>
                        )}
                        {aiMethodRec && (
                            <div className="bg-white border border-blue-100 rounded-lg p-3 space-y-2">
                                <div className="flex items-center flex-wrap gap-2">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-400">🤖 AI suggests</span>
                                    <span
                                        className="text-xs font-extrabold px-2.5 py-1 rounded-lg border"
                                        style={{
                                            background: `${rcaMethodColor(aiMethodRec.method)}14`,
                                            color: rcaMethodColor(aiMethodRec.method),
                                            borderColor: `${rcaMethodColor(aiMethodRec.method)}40`,
                                        }}
                                    >
                                        {rcaMethodLabel(aiMethodRec.method)}
                                    </span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        aiMethodRec.confidence >= 0.85 ? 'bg-emerald-100 text-emerald-700'
                                        : aiMethodRec.confidence >= 0.7 ? 'bg-blue-100 text-blue-700'
                                        : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {Math.round(aiMethodRec.confidence * 100)}%
                                    </span>
                                    {inv.method === aiMethodRec.method && (
                                        <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                                            <Check size={11} /> Committed
                                        </span>
                                    )}
                                    <button
                                        onClick={() => { setAiMethodRec(null); setAiMethodError(null); }}
                                        className="ml-auto text-slate-300 hover:text-slate-500 transition-colors"
                                        title="Dismiss"
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{aiMethodRec.reasoning}</p>
                                {aiMethodRec.alternatives && aiMethodRec.alternatives.length > 0 && (
                                    <div className="text-[11px] text-slate-400">
                                        <span className="font-bold text-slate-500">Alternatives: </span>
                                        {aiMethodRec.alternatives.map((alt, i) => (
                                            <span key={alt.method}>
                                                {i > 0 && ' · '}
                                                <span className="font-semibold text-slate-600">{alt.label || alt.method}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Cause analysis ──────────────────────────────────────────────
                            The four tools (5-Why, Fishbone, Fault Tree, Logic Tree) are diagrams:
                            they want the whole screen, not a column squeezed between a stepper and
                            a nav bar. Step 3 rests as a summary of what you've found; the tool
                            opens as a full-screen workspace. */}
                        {methodCommitted && VISUAL_DIAGRAM_METHODS.includes(inv.method || '') && (
                            <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                                <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5 mb-4">
                                    <div className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2 min-w-0">
                                        <Search className="w-4 h-4 text-blue-600 shrink-0" />
                                        <span className="truncate">Cause analysis</span>
                                        <span
                                            className="text-[10px] font-extrabold px-2 py-0.5 rounded-md border shrink-0"
                                            style={{
                                                background: `${rcaMethodColor(inv.method)}14`,
                                                color: rcaMethodColor(inv.method),
                                                borderColor: `${rcaMethodColor(inv.method)}40`,
                                            }}
                                        >
                                            {rcaMethodLabel(inv.method)}
                                        </span>
                                    </div>
                                    <Button onClick={() => setCauseFullscreen(true)} className="shrink-0">
                                        <Maximize2 size={14} strokeWidth={2.5} />
                                        <span className="hidden sm:inline">Open workspace</span>
                                        <span className="sm:hidden">Open</span>
                                    </Button>
                                </div>

                                {/* Summary of what the tool has recorded so far */}
                                {scopedNodes.filter(n => n.node_type !== 'problem' && n.node_type !== 'category').length === 0 ? (
                                    <button
                                        onClick={() => setCauseFullscreen(true)}
                                        className="w-full py-8 text-center text-slate-400 hover:text-blue-600 font-medium text-xs transition-colors"
                                    >
                                        No causes recorded yet — open the {rcaMethodLabel(inv.method)} workspace to start.
                                    </button>
                                ) : (
                                    <div className="space-y-1.5">
                                        {scopedNodes
                                            .filter(n => n.node_type !== 'problem' && n.node_type !== 'category')
                                            .map(n => (
                                                <div
                                                    key={n.id}
                                                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-sm ${
                                                        n.is_root_cause || n.node_type === 'root_cause'
                                                            ? 'bg-rose-50 border-rose-200 text-rose-900 font-semibold'
                                                            : 'bg-slate-50 border-slate-200 text-slate-700'
                                                    }`}
                                                >
                                                    {(n.is_root_cause || n.node_type === 'root_cause')
                                                        ? <Target size={14} className="text-rose-500 mt-0.5 shrink-0" />
                                                        : <Circle size={8} className="text-slate-300 mt-1.5 shrink-0" />}
                                                    <span className="min-w-0">{n.description}</span>
                                                    {(n.is_root_cause || n.node_type === 'root_cause') && (
                                                        <span className="ml-auto text-[9px] font-extrabold uppercase tracking-wider text-rose-500 shrink-0">
                                                            Root cause
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Cause Tree (flat list) — only for legacy records on a method with no
                            editor (taproot / apollo). The gate offers no such option, so this is
                            a fallback for old investigations, not a path anyone can newly enter. */}
                        {methodCommitted && !VISUAL_DIAGRAM_METHODS.includes(inv.method || '') && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <AlertTriangle size={16} className="text-blue-600" /> Causal Factor Identification
                            </div>
                            
                            <div className="space-y-2 mb-5">
                                {nodes.map(n => (
                                    <div 
                                        key={n.id} 
                                        className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 shadow-sm transition-all animate-in slide-in-from-left duration-250"
                                        style={{ marginLeft: isMobile ? n.depth * 12 : n.depth * 24 }}
                                    >
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {n.is_root_cause && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-700 tracking-wide uppercase">ROOT CAUSE</span>}
                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 tracking-wide uppercase">
                                                {n.node_type === 'problem' ? 'PROBLEM' : n.node_type === 'why' ? `WHY ${n.depth}` : n.node_type.toUpperCase()}
                                            </span>
                                            {n.cause_category && (
                                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border tracking-wide uppercase ${
                                                    n.cause_category === 'physical' ? 'border-red-200 bg-red-50 text-red-700' :
                                                    n.cause_category === 'human' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                                                    'border-blue-200 bg-blue-50 text-blue-700'
                                                }`}>
                                                    {n.cause_category}
                                                </span>
                                            )}
                                            {n.cause_code && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-primary-200 bg-primary-50 text-primary-700 tracking-wide uppercase">{n.cause_code}</span>}
                                        </div>
                                        <span className="text-sm font-bold text-slate-800 flex-1">{n.description}</span>
                                        <button 
                                            onClick={async () => { await analyzeService.deleteRCANode(n.id); setNodes(ns => ns.filter(x => x.id !== n.id)); }}
                                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-100 rounded-lg transition-colors cursor-pointer shrink-0 ml-auto sm:ml-0 min-w-[32px] min-h-[32px] flex items-center justify-center"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                                {nodes.length === 0 && (
                                    <div className="py-8 text-center text-slate-400 font-medium text-xs">No causal factors defined. Begin mapping nodes below.</div>
                                )}
                            </div>

                            <div className="flex flex-col lg:flex-row gap-3 mt-5 items-stretch lg:items-end border-t border-slate-100 pt-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Node Type</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newNodeType} 
                                            onChange={e => setNewNodeType(e.target.value)}
                                        >
                                            <option value="problem">Problem</option>
                                            <option value="why">Why</option>
                                            <option value="category">Category</option>
                                            <option value="root_cause">Root Cause</option>
                                            <option value="contributing_factor">Contributing Factor</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Cause Layer</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newNodeCauseCategory} 
                                            onChange={e => setNewNodeCauseCategory(e.target.value)}
                                        >
                                            <option value="">— Choose Layer —</option>
                                            {CAUSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">ISO 14224 Code</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newNodeCauseCode} 
                                            onChange={e => setNewNodeCauseCode(e.target.value)}
                                        >
                                            <option value="">— Cause Code —</option>
                                            {taxonomy.map(t => <option key={t.code} value={t.code}>{t.code} — {t.description}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex-1 lg:flex-[2]">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Statement Description</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        placeholder="Description of this Causal Event" 
                                        value={newNodeDesc} 
                                        onChange={e => setNewNodeDesc(e.target.value)} 
                                    />
                                </div>
                                <button 
                                    className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer text-xs lg:h-[38px] shrink-0"
                                    onClick={addNode}
                                >
                                    <Plus size={14} strokeWidth={2.5} /> Add
                                </button>
                            </div>
                        </div>
                        )}

                        {/* Barrier Analysis — optional, collapsed by default when empty */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <button
                                type="button"
                                onClick={() => setBarriersOpen(!(barriersOpen ?? barriers.length > 0))}
                                className={`w-full text-sm sm:text-base font-extrabold text-slate-900 flex items-center justify-between gap-2 ${(barriersOpen ?? barriers.length > 0) ? 'border-b border-slate-100 pb-3.5 mb-4' : ''}`}
                            >
                                <span className="flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-blue-600" /> Barrier Analysis (Defense-in-Depth)
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">Optional</span>
                                    {barriers.length > 0 && (
                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">{barriers.length}</span>
                                    )}
                                </span>
                                <ChevronDown size={16} className={`text-slate-400 transition-transform ${(barriersOpen ?? barriers.length > 0) ? 'rotate-180' : ''}`} />
                            </button>
                            {(barriersOpen ?? barriers.length > 0) && (<>
                            <p className="text-xs text-slate-400 font-medium mb-4">
                                Define what design controls, technical trips, human checks, or organizational policies should have prevented or mitigated this failure. Most valuable for safety and incident investigations.
                            </p>
                            
                            <div className="space-y-2">
                                {barriers.map(b => {
                                    const ass = BARRIER_ASSESSMENTS.find(a => a.value === b.assessment) || { color: 'text-slate-500 bg-slate-50 border-slate-200' };
                                    return (
                                        <div key={b.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-colors">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border tracking-wide uppercase ${
                                                    b.barrier_type === 'preventive' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                                                }`}>{b.barrier_type}</span>
                                                <span className="text-[9px] font-extrabold px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded tracking-wide uppercase">{b.barrier_class}</span>
                                            </div>
                                            <span className="text-sm font-bold text-slate-800 flex-1">{b.description}</span>
                                            <span className={`text-[9px] font-extrabold px-2.5 py-0.5 border rounded-full shrink-0 ml-auto sm:ml-0 ${ass.color}`}>
                                                {b.assessment?.replace('_', ' ').toUpperCase()}
                                            </span>
                                        </div>
                                    );
                                })}
                                {barriers.length === 0 && (
                                    <div className="py-8 text-center text-slate-400 font-medium text-xs">No safeguard barriers recorded. Add details below.</div>
                                )}
                            </div>

                            <div className="flex flex-col lg:flex-row gap-3 mt-5 items-stretch lg:items-end border-t border-slate-100 pt-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Type</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newBarrierType} 
                                            onChange={e => setNewBarrierType(e.target.value)}
                                        >
                                            {BARRIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Classification</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newBarrierClass} 
                                            onChange={e => setNewBarrierClass(e.target.value)}
                                        >
                                            {BARRIER_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            value={newBarrierAssessment} 
                                            onChange={e => setNewBarrierAssessment(e.target.value)}
                                        >
                                            {BARRIER_ASSESSMENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex-1 lg:flex-[2]">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Safeguard Description</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        placeholder="Trips, training guidelines, mechanical containment, etc." 
                                        value={newBarrierDesc} 
                                        onChange={e => setNewBarrierDesc(e.target.value)} 
                                    />
                                </div>
                                <button 
                                    className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer text-xs lg:h-[38px] shrink-0"
                                    onClick={addBarrier}
                                >
                                    <Plus size={14} strokeWidth={2.5} /> Add
                                </button>
                            </div>
                            </>)}
                        </div>
                        {/* Challenge — AI stress-tests THIS cause analysis against the asset's evidence */}
                        <RcaChallengerPanel
                            initialText={[
                                inv.problem_statement ? `Problem: ${inv.problem_statement}` : '',
                                (() => {
                                    const rc = nodes.filter(n => n.is_root_cause || n.node_type === 'root_cause');
                                    const why = nodes.filter(n => n.node_type === 'why').sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
                                    const c = rc.length ? rc : why;
                                    return c.length ? `Proposed cause(s): ${c.map(n => n.description).join(' → ')}` : (inv.root_cause_summary ? `Proposed root cause: ${inv.root_cause_summary}` : '');
                                })(),
                            ].filter(Boolean).join('\n\n')}
                            assetTag={allHierarchyAssets.find(a => a.id === (inv.asset_id || draft.asset_id))?.tag || ''}
                        />
                    </div>
                )}

                {/* ── STEP 4: Develop Solutions ────────────────────── */}
                {activeStep === 4 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-blue-600" /> Corrective Actions & Recommendations
                            </div>
                            <p className="text-xs text-slate-400 font-medium mb-5">
                                Formulate corrective action plans. Group recommendations cleanly under cause categories (Physical, Human, Latent).
                            </p>
                            
                            {CAUSE_CATEGORIES.map(cat => {
                                const catActions = actions.filter(a => a.cause_category === cat.value);
                                if (catActions.length === 0 && actions.length > 0) return null;
                                return (
                                    <div key={cat.value} className="mb-6 last:mb-0">
                                        <h4 
                                            className="text-xs font-extrabold tracking-wider uppercase mb-3 pb-1 border-b border-slate-100 flex items-center justify-between"
                                            style={{ color: cat.color }}
                                        >
                                            <span>{cat.label} Causes</span>
                                            <span className="bg-slate-100 px-2 py-0.5 rounded-full text-slate-500 text-[10px] normal-case">{catActions.length} recommendations</span>
                                        </h4>
                                        <div className="space-y-2">
                                            {catActions.map(a => (
                                                <div key={a.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-colors">
                                                    <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border shrink-0 tracking-wide uppercase ${
                                                        a.action_type === 'immediate' ? 'bg-red-50 text-red-700 border-red-200' :
                                                        a.action_type === 'short_term' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                        'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    }`}>
                                                        {a.action_type?.replace('_', ' ').toUpperCase()}
                                                    </span>
                                                    <span className="text-sm font-bold text-slate-800 flex-1">{a.action_description}</span>
                                                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                                                        {a.assigned_to && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded">
                                                                <Users size={10} /> {a.assigned_to}
                                                            </span>
                                                        )}
                                                        {a.due_date && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded">
                                                                <Clock size={10} /> {a.due_date}
                                                            </span>
                                                        )}
                                                        <span className={`text-[9px] font-extrabold px-2.5 py-0.5 border rounded-full uppercase tracking-wider ${
                                                            a.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                            a.status === 'overdue' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                            'bg-blue-50 text-blue-700 border-blue-200'
                                                        }`}>
                                                            {a.status?.toUpperCase()}
                                                        </span>
                                                        {a.requires_moc && (
                                                            <span className="text-[9px] font-extrabold px-2 py-0.5 border border-amber-200 bg-amber-50 text-amber-700 rounded tracking-wide uppercase">MoC Required</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            {actions.length === 0 && (
                                <div className="py-8 text-center text-slate-400 font-medium text-xs">
                                    No corrective actions yet. Each root cause you identified should have one.
                                </div>
                            )}

                            {/* Was a 6-field row inline: on a phone it stacked into a column you had
                                to scroll the whole action list to reach. Sheet. */}
                            <button
                                onClick={() => setAddActionOpen(true)}
                                className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50 font-bold text-xs transition-colors"
                            >
                                <Plus size={14} strokeWidth={2.5} /> Add corrective action
                            </button>
                        </div>
                    </div>
                )}

                {/* ── STEP 5: Implement ────────────────────────────── */}
                {activeStep === 5 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                                <ClipboardList className="w-4 h-4 text-blue-600" /> Implementation Tracker
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center shadow-xs relative overflow-hidden">
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                                    <div className="text-2xl md:text-3xl font-black text-emerald-600 mb-0.5">{actions.filter(a => a.status === 'completed').length}</div>
                                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Completed</div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center shadow-xs relative overflow-hidden">
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
                                    <div className="text-2xl md:text-3xl font-black text-blue-600 mb-0.5">{actions.filter(a => a.status === 'in_progress').length}</div>
                                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">In Progress</div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center shadow-xs relative overflow-hidden">
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
                                    <div className="text-2xl md:text-3xl font-black text-rose-600 mb-0.5">{actions.filter(a => a.status === 'open' || a.status === 'overdue').length}</div>
                                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Open / Overdue</div>
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div className="mb-6 space-y-1.5">
                                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                                    <span>TASK EXECUTION PROGRESS</span>
                                    <span className="text-blue-600">{actions.length ? Math.round((actions.filter(a => a.status === 'completed').length / actions.length) * 100) : 0}%</span>
                                </div>
                                <div className="w-full bg-slate-100 border border-slate-200/50 rounded-full h-2.5 overflow-hidden">
                                    <div 
                                        className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500" 
                                        style={{ width: `${actions.length ? (actions.filter(a => a.status === 'completed').length / actions.length) * 100 : 0}%` }} 
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                {actions.map(a => (
                                    <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-colors">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border shrink-0 tracking-wide uppercase ${
                                                a.cause_category === 'physical' ? 'bg-red-50 border-red-200 text-red-700' :
                                                a.cause_category === 'human' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                                'bg-blue-50 border-blue-200 text-blue-700'
                                            }`}>
                                                {a.cause_category}
                                            </span>
                                            <span className="text-sm font-bold text-slate-800">{a.action_description}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {/* Close the loop: corrective action → real work in Work Management */}
                                            {a.work_order_id ? (
                                                <button
                                                    onClick={() => navigate(`/work-orders/${a.work_order_id}`)}
                                                    className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                                                    title="Open the linked work order"
                                                >
                                                    <Wrench size={10} /> WO linked ↗
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => setRaiseAction(a)}
                                                    className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors flex items-center gap-1"
                                                    title="Raise a corrective Work Order or Maintenance Request for this action"
                                                >
                                                    <Plus size={10} /> Raise work
                                                </button>
                                            )}
                                            <select
                                                className="w-full sm:w-36 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all cursor-pointer shadow-xs shrink-0"
                                                value={a.status}
                                                onChange={async e => {
                                                    const updated = await analyzeService.updateRCACorrectiveAction(a.id, { status: e.target.value as any });
                                                    if (updated) setActions(acts => acts.map(x => x.id === a.id ? updated : x));
                                                }}
                                            >
                                                <option value="open">Open</option>
                                                <option value="in_progress">In Progress</option>
                                                <option value="completed">Completed</option>
                                                <option value="overdue">Overdue</option>
                                                <option value="cancelled">Cancelled</option>
                                            </select>
                                        </div>
                                    </div>
                                ))}
                                {actions.length === 0 && (
                                    <div className="py-8 text-center text-slate-400 font-medium text-xs">No corrective action records to track status.</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 6: Track Effectiveness ──────────────────── */}
                {activeStep === 6 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-blue-600" /> Effectiveness Verification & Audit
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness Review Due Date</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        type="date" 
                                        value={inv.effectiveness_due?.split('T')[0] || ''} 
                                        onChange={async e => {
                                            await analyzeService.updateRCAInvestigation(inv.id, { effectiveness_due: e.target.value } as any);
                                            setInv(i => i ? { ...i, effectiveness_due: e.target.value } : i);
                                        }} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness Verification Status</label>
                                    <select 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                        value={inv.effectiveness_status || 'pending'} 
                                        onChange={async e => {
                                            await analyzeService.updateRCAInvestigation(inv.id, { effectiveness_status: e.target.value } as any);
                                            setInv(i => i ? { ...i, effectiveness_status: e.target.value as any } : i);
                                        }}
                                    >
                                        <option value="pending">Pending Verification</option>
                                        <option value="effective">Effective — Chronic Defect Eliminated</option>
                                        <option value="ineffective">Ineffective — Requires RCA Revision</option>
                                        <option value="recurred">Recurred — Asset Re-failed (New RCA Required)</option>
                                    </select>
                                </div>
                            </div>

                            {/* "New RCA Required" used to be a dead end: the status said so and then
                                left you to go and build it yourself. Close the loop — the follow-up
                                opens pre-seeded with this investigation's asset and history. */}
                            {inv.effectiveness_status === 'recurred' && (
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                                    <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                                    <p className="flex-1 text-xs text-amber-900 leading-relaxed">
                                        The fix did not hold. A recurrence means the real root was never
                                        reached — the follow-up should start from what this one missed.
                                    </p>
                                    <Button
                                        className="shrink-0"
                                        onClick={() => navigate('/analyze/rca/new', {
                                            state: {
                                                title: `RCA: recurrence of "${inv.title}"`,
                                                asset_id: inv.asset_id || '',
                                                description:
                                                    `Recurrence following investigation "${inv.title}".\n\n` +
                                                    `Previous root cause: ${inv.root_cause_summary || '(not recorded)'}\n\n` +
                                                    `The corrective actions from that investigation did not prevent re-failure — ` +
                                                    `treat the previous root cause as a symptom and carry the analysis further ` +
                                                    `(physical → human → latent).`,
                                            },
                                        })}
                                    >
                                        Start follow-up RCA
                                    </Button>
                                </div>
                            )}

                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Root Cause Summary (Final Engineering Sign-off)</label>
                                <textarea 
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm min-h-[100px] resize-y"
                                    value={inv.root_cause_summary || ''} 
                                    onChange={async e => {
                                        const val = e.target.value;
                                        setInv(i => i ? { ...i, root_cause_summary: val } : i);
                                    }} 
                                    onBlur={async () => {
                                        if (inv) await analyzeService.updateRCAInvestigation(inv.id, { root_cause_summary: inv.root_cause_summary } as any);
                                    }} 
                                    placeholder="Summarize the confirmed physical/latent root causes and provide engineering insights on barrier effectiveness…" 
                                />
                            </div>
                        </div>

                        {/* Audit Trail */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <Clock size={16} className="text-blue-600" /> Audit Log History
                            </div>
                            
                            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                {auditLog.slice(0, 10).map(log => (
                                    <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-all text-xs text-slate-600">
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <span className="text-slate-400 font-bold shrink-0">{new Date(log.created_at).toLocaleString()}</span>
                                            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded border border-blue-100 bg-blue-50 text-blue-700 tracking-wide uppercase shrink-0">{log.action}</span>
                                            <span className="text-slate-800 font-bold shrink-0">{log.changed_by}</span>
                                        </div>
                                    </div>
                                ))}
                                {auditLog.length === 0 && (
                                    <p className="py-6 text-center text-slate-400 font-medium text-xs">No audit entries logged yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── DE TASK CREATION MODAL ─────────────────────────── */}
                {showDEModal && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-all">
                        <div className="bg-white border border-slate-100 shadow-2xl rounded-2xl p-6 md:p-8 max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                            {deCreated ? (
                                /* Success state */
                                <div className="text-center py-12 px-6">
                                    <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-4 animate-bounce">
                                        <CheckCircle2 size={32} className="text-emerald-500" />
                                    </div>
                                    <h3 className="text-lg font-black text-slate-900 mb-1">DE Task Successfully Created!</h3>
                                    <p className="text-xs text-slate-400 font-semibold">
                                        Redirecting... track execution in the Defect Elimination tab.
                                    </p>
                                </div>
                            ) : (
                                /* Form state */
                                <>
                                    {/* Modal header */}
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                                                <Target size={18} strokeWidth={2.5} />
                                            </div>
                                            <div>
                                                <h3 className="text-base font-black text-slate-900 leading-tight">Create Defect Elimination Task</h3>
                                                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Automated draft populated from investigation data</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => setShowDEModal(false)} 
                                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>

                                    {/* RCA source badge */}
                                    <div className="flex items-center gap-2 p-3 bg-blue-50/40 border border-blue-100 rounded-xl text-xs text-slate-600 mb-4 shrink-0">
                                        <Zap size={14} className="text-blue-600 shrink-0" />
                                        <span>Source Investigation:</span>
                                        <span className="font-bold text-blue-700 truncate max-w-[200px]">{inv?.title || draft.title}</span>
                                        <span className="ml-auto text-[9px] font-extrabold px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 tracking-wide uppercase shrink-0">
                                            {rcaMethodLabel(inv?.method)}
                                        </span>
                                    </div>

                                    {/* Scrollable form body */}
                                    <div className="flex-1 overflow-y-auto pr-1 py-1 space-y-4">
                                        {/* Title */}
                                        <div>
                                            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Task Title</label>
                                            <input 
                                                value={deDraft.title}
                                                onChange={e => setDeDraft(d => ({ ...d, title: e.target.value }))}
                                                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm"
                                            />
                                        </div>

                                        {/* Root Cause Summary */}
                                        <div>
                                            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-rose-500 mb-1 flex items-center gap-1.5">
                                                <AlertTriangle size={11} strokeWidth={2.5} /> Root Cause Summary
                                            </label>
                                            <textarea 
                                                value={deDraft.rootCauseSummary}
                                                onChange={e => setDeDraft(d => ({ ...d, rootCauseSummary: e.target.value }))}
                                                rows={3}
                                                className="w-full px-3 py-2 text-xs bg-rose-50/10 border border-rose-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all shadow-sm rounded-lg resize-y leading-relaxed"
                                            />
                                        </div>

                                        {/* Proposed Solution */}
                                        <div>
                                            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 mb-1 flex items-center gap-1.5">
                                                <Wrench size={11} strokeWidth={2.5} /> Proposed Defect Elimination Solution
                                            </label>
                                            <textarea 
                                                value={deDraft.proposedSolution}
                                                onChange={e => setDeDraft(d => ({ ...d, proposedSolution: e.target.value }))}
                                                rows={3}
                                                className="w-full px-3 py-2 text-xs bg-emerald-50/10 border border-emerald-200 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm rounded-lg resize-y leading-relaxed"
                                            />
                                        </div>

                                        {/* Priority */}
                                        <div>
                                            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">Priority</label>
                                            <select 
                                                value={deDraft.priority}
                                                onChange={e => setDeDraft(d => ({ ...d, priority: e.target.value as any }))}
                                                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm cursor-pointer"
                                            >
                                                <option value="critical">Critical</option>
                                                <option value="high">High</option>
                                                <option value="medium">Medium</option>
                                                <option value="low">Low</option>
                                            </select>
                                        </div>

                                        {/* Financial estimates */}
                                        <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-3">
                                            <div>
                                                <label className="block text-[9px] font-extrabold text-rose-600 tracking-wider">ANNUAL COST ($)</label>
                                                <input 
                                                    type="number" 
                                                    value={deDraft.annualCost}
                                                    onChange={e => setDeDraft(d => ({ ...d, annualCost: Number(e.target.value) }))}
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm mt-1"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-extrabold text-emerald-600 tracking-wider">EST. SAVINGS ($)</label>
                                                <input 
                                                    type="number" 
                                                    value={deDraft.estimatedSavings}
                                                    onChange={e => setDeDraft(d => ({ ...d, estimatedSavings: Number(e.target.value) }))}
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm mt-1"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-extrabold text-amber-600 tracking-wider">IMPL. COST ($)</label>
                                                <input 
                                                    type="number" 
                                                    value={deDraft.implementationCost}
                                                    onChange={e => setDeDraft(d => ({ ...d, implementationCost: Number(e.target.value) }))}
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-blue-500 transition-all shadow-sm mt-1"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Modal footer */}
                                    <div className="flex gap-2.5 mt-5 justify-end border-t border-slate-100 pt-4 shrink-0">
                                        <button 
                                            onClick={() => setShowDEModal(false)}
                                            className="px-4 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold rounded-lg cursor-pointer text-xs transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button 
                                            onClick={handleCreateDETask} 
                                            disabled={deCreating || !deDraft.title.trim()}
                                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg cursor-pointer text-xs flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-60"
                                        >
                                            <Target size={13} strokeWidth={2.5} />
                                            {deCreating ? 'Creating…' : 'Create DE Task'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Nav buttons */}
                <div className="flex items-center justify-between gap-4 mt-6 pt-5 border-t border-slate-200">
                    {activeStep > 1 ? (
                        <button 
                            className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                            onClick={() => goStep(activeStep - 1)}
                        >
                            <ChevronLeft size={15} strokeWidth={2.5} /> Previous
                        </button>
                    ) : <div />}
                    {activeStep < 6 ? (
                        <button 
                            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow"
                            onClick={async () => { await handleSave(); goStep(activeStep + 1); }}
                        >
                            Next <ChevronRight size={15} strokeWidth={2.5} />
                        </button>
                    ) : (
                        <button 
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow"
                            onClick={async () => {
                                if (inv) {
                                    await analyzeService.updateRCAInvestigation(inv.id, { status: 'closed', closed_at: new Date().toISOString() } as any);
                                    await analyzeService.logRCAAudit({ investigation_id: inv.id, action: 'closed', changed_by: 'system', details: {} });
                                    navigate('/analyze');
                                }
                            }}
                        >
                            <CheckCircle2 size={15} strokeWidth={2.5} /> Close Investigation
                        </button>
                    )}
                </div>
            </div>

            {/* ══ CAUSE WORKSPACE — full screen ═══════════════════════════════════
                Every RCA tool is a diagram, and a diagram needs room. Fishbone alone wants
                ~980px of layout; inside the step column on a phone it was unusable. Here it
                gets the whole viewport, with the page's own chrome out of the way. */}
            {causeFullscreen && inv && methodCommitted && createPortal(
                <div className="fixed inset-0 z-[80] bg-slate-50 flex flex-col">
                    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b border-slate-200 shrink-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <span
                                className="text-[10px] font-extrabold px-2 py-1 rounded-md border shrink-0"
                                style={{
                                    background: `${rcaMethodColor(inv.method)}14`,
                                    color: rcaMethodColor(inv.method),
                                    borderColor: `${rcaMethodColor(inv.method)}40`,
                                }}
                            >
                                {rcaMethodLabel(inv.method)}
                            </span>
                            <div className="min-w-0">
                                <div className="text-sm font-bold text-slate-800 truncate">{inv.title}</div>
                                <div className="text-[11px] text-slate-400 truncate hidden sm:block">
                                    {inv.problem_statement || 'Cause analysis'}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {/* Everything in here saves as you go — this button is just "I'm done looking". */}
                            <Button variant="secondary" onClick={() => setCauseFullscreen(false)}>
                                <Minimize2 size={14} strokeWidth={2.5} />
                                <span className="hidden sm:inline">Done</span>
                            </Button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 sm:p-5">
                        {inv.method === 'five_why' && (
                            <FiveWhySection
                                selectedRca={{ id: inv.id, method: inv.method, root_cause_summary: inv.root_cause_summary }}
                                nodes={scopedNodes}
                                setNodes={setNodes}
                                onEscalate={() => {
                                    setCauseFullscreen(false);
                                    setTimeout(() => methodGateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                                }}
                            />
                        )}
                        {(inv.method === 'fishbone' || inv.method === 'fault_tree' || inv.method === 'logic_tree') && (
                            <CauseAnalysisSection
                                method={inv.method}
                                investigationId={inv.id}
                                problemStatement={inv.problem_statement || draft.problem_statement || ''}
                                nodes={scopedNodes}
                                setNodes={setNodes}
                                saving={saving}
                            />
                        )}
                    </div>
                </div>,
                document.body,
            )}

            {/* ── Add evidence (step 2) ───────────────────────────────────────── */}
            <Drawer
                open={addEvidenceOpen}
                onClose={() => setAddEvidenceOpen(false)}
                title="Add evidence"
                subtitle="What you found, and where it came from"
                width="md"
                footer={
                    <div className="flex gap-2">
                        <Button variant="secondary" className="flex-1" onClick={() => setAddEvidenceOpen(false)}>Cancel</Button>
                        <Button className="flex-1" onClick={addEvidence} disabled={!newEvTitle.trim()}>Add evidence</Button>
                    </div>
                }
            >
                <div className="p-4 space-y-4">
                    <Field label="Evidence type">
                        <Select value={newEvType} onChange={e => setNewEvType(e.target.value)}>
                            <option value="note">Note</option>
                            <option value="photo">Photo</option>
                            <option value="document">Document</option>
                            <option value="work_order">Work Order</option>
                            <option value="fmea">FMEA</option>
                            <option value="sensor_data">Sensor Data</option>
                            <option value="timeline_event">Timeline Event</option>
                        </Select>
                    </Field>
                    <Field label="Title">
                        <Input
                            placeholder="Title / reference tag"
                            value={newEvTitle}
                            onChange={e => setNewEvTitle(e.target.value)}
                            autoFocus
                        />
                    </Field>
                    <Field label="Details" hint="Content, URL, or a note about what this shows">
                        <Textarea
                            rows={4}
                            placeholder="e.g. Seal face scored circumferentially; photo taken before disassembly"
                            value={newEvContent}
                            onChange={e => setNewEvContent(e.target.value)}
                        />
                    </Field>
                </div>
            </Drawer>

            {/* ── Add corrective action (step 4) ──────────────────────────────── */}
            <Drawer
                open={addActionOpen}
                onClose={() => setAddActionOpen(false)}
                title="Add corrective action"
                subtitle="What will be done, by whom, by when"
                width="md"
                footer={
                    <div className="flex gap-2">
                        <Button variant="secondary" className="flex-1" onClick={() => setAddActionOpen(false)}>Cancel</Button>
                        <Button className="flex-1" onClick={addAction} disabled={!newActionDesc.trim()}>Add action</Button>
                    </div>
                }
            >
                <div className="p-4 space-y-4">
                    <Field label="Action" hint="Be concrete — what exactly will change?">
                        <Textarea
                            rows={3}
                            placeholder="e.g. Raise MoC to change seal grade to Viton Extreme-90"
                            value={newActionDesc}
                            onChange={e => setNewActionDesc(e.target.value)}
                            autoFocus
                        />
                    </Field>
                    <Field label="Targets which cause layer?" hint="The physical cause is never the root — actions against latent causes are the ones that stop recurrence.">
                        <Select value={newActionCategory} onChange={e => setNewActionCategory(e.target.value)}>
                            {CAUSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Horizon">
                            <Select value={newActionType} onChange={e => setNewActionType(e.target.value)}>
                                <option value="immediate">Immediate</option>
                                <option value="short_term">Short-term</option>
                                <option value="long_term">Long-term</option>
                            </Select>
                        </Field>
                        <Field label="Due date">
                            <Input type="date" value={newActionDue} onChange={e => setNewActionDue(e.target.value)} />
                        </Field>
                    </div>
                    <Field label="Assignee" hint="An action with no owner is a wish.">
                        <Input
                            placeholder="Who owns this?"
                            value={newActionAssignee}
                            onChange={e => setNewActionAssignee(e.target.value)}
                        />
                    </Field>
                </div>
            </Drawer>

            {showTeamPanel && (
                <TeamPanel
                    collaborators={rcaCollaborators}
                    onAdd={handleAddCollaborator}
                    onRemove={handleRemoveCollaborator}
                    onUpdateRole={handleUpdateCollaboratorRole}
                    onClose={() => setShowTeamPanel(false)}
                    accentColor="violet"
                />
            )}

            {/* ── Reliability Specialist: agentic facilitator, every step ──
                One persona everywhere; launcher clears the mobile bottom nav. */}
            {inv && !copilotOpen && (
                <button
                    onClick={() => setCopilotOpen(true)}
                    className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40 w-11 h-11 flex items-center justify-center rounded-full bg-gradient-to-r from-primary-600 to-primary-500 text-white text-base font-extrabold shadow-glow-relantern hover:shadow-xl hover:scale-[1.05] transition-all"
                    title="Reliability Specialist — facilitates this investigation with you. Advisory only: you decide."
                    aria-label="Open Reliability Specialist"
                >
                    S
                </button>
            )}
            {inv && copilotOpen && (
                <RcaCopilotPanel
                    inv={inv}
                    nodes={nodes}
                    onApplied={() => fetchAll(inv.id)}
                    onClose={() => setCopilotOpen(false)}
                />
            )}

            {/* Raise corrective WO / Request from a corrective action (Step 5).
                On create, the WO id is written back to the action so the loop
                RCA → corrective action → work order is closed and visible. */}
            {raiseAction && inv && (() => {
                const rcaAsset = allHierarchyAssets.find(a => a.id === inv.asset_id);
                return (
                    <RaiseWorkModal
                        asset={(rcaAsset || { id: inv.asset_id || '', tag: 'Unassigned', name: inv.title, criticality: 'B' }) as any}
                        kind="WO"
                        actor={profile?.username || profile?.fullName || 'user'}
                        requesterId={profile?.id}
                        sourceLabel="RCA"
                        faultTypes={rcaFaultTypes}
                        contextNote={`From RCA "${inv.title}" — corrective action (${raiseAction.cause_category || 'uncategorised'}): ${raiseAction.action_description}${inv.root_cause_summary ? `\nRoot cause: ${inv.root_cause_summary}` : ''}`}
                        onCreated={async (kind, id) => {
                            if (kind === 'WO' && id) {
                                const updated = await analyzeService.updateRCACorrectiveAction(raiseAction.id, {
                                    work_order_id: id,
                                    status: raiseAction.status === 'open' ? 'in_progress' : raiseAction.status,
                                } as any);
                                if (updated) setActions(acts => acts.map(x => x.id === raiseAction.id ? updated : x));
                            }
                        }}
                        onClose={() => setRaiseAction(null)}
                    />
                );
            })()}
        </div>
    );
}

export default RCAInvestigationPage;
