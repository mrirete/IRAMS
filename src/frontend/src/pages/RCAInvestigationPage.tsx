import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAssetContext } from '../contexts/AssetContext';
import {
    ArrowLeft, CheckCircle2, Circle, Lock, ChevronRight, ChevronLeft, ChevronDown,
    AlertTriangle, FileText, Search, Shield, Wrench, BarChart3,
    Plus, Trash2, Users, ClipboardList, Clock, Flag, Bot,
    Target, Zap, DollarSign, X, Database, MapPin, Loader2, Check, MoreHorizontal,
    Maximize2, Minimize2, Paperclip, Upload
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Drawer, Modal, Button, Field, Input, Select, Textarea } from '../eam/components/ui';
import RCAStepGuide from '../components/analyze/RCAStepGuide';
import { getStepCompletion } from '../components/analyze/RCAStepIndicator';
import { friendlyAIError } from '../eam/lib/aiError';
import { analyzeService, scopeNodesToMethod, rcaMethodLabel, rcaMethodColor, EVIDENCE_GRADES, bestEvidenceGrade, nodeConfidence, rootCauseConfidence, confidenceFromScore } from '../eam/services/AnalyzeService';
import { rcmService } from '../eam/services/RCMService';
import { pinFailureMode } from '../lib/rcmBreakdown';
import { suggestRcaMethod } from '../lib/rcaMethodSuggest';
import { classifyWoStatus } from '../lib/woState';
import { actionsSettled as settleActions, mocGate, resolveAssignee, isAssigned, fmeaSeverity, fmeaOccurrence, fmeaDetection, type Person } from '../lib/rcaActions';
import { EvidenceGradeBadge } from '../components/analyze/RCAEvidencePanel';
import { nodeSupport } from '../components/analyze/NodeEvidenceChip';
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
    StudyCollaborator, RCANodeEvidenceLink, EvidenceQualityGrade,
} from '../eam/services/AnalyzeService';

// ── Step definitions ─────────────────────────────────────────
const STEPS = [
    { num: 1, label: 'Define Problem', icon: FileText, desc: 'What happened' },
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

/**
 * One "prevent the next one" hand-off: what it is for, whether it has been done,
 * and the one button that does it or opens what it made.
 */
const Handoff: React.FC<{
    icon: React.ReactNode; title: string; purpose: string;
    done: { label: string; onOpen: () => void } | null;
    blocked?: string | null; busy?: boolean; actLabel: string; onAct: () => void;
}> = ({ icon, title, purpose, done, blocked, busy, actLabel, onAct }) => (
    <div className={`rounded-xl border p-3.5 flex flex-col gap-2 ${done ? 'border-emerald-200 bg-emerald-50/40' : blocked ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <span className={done ? 'text-emerald-600' : 'text-primary-600'}>{icon}</span> {title}
            {done && <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check size={11} strokeWidth={3} /> done</span>}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed flex-1">{purpose}</p>
        {done ? (
            <button type="button" onClick={done.onOpen}
                className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                {done.label} ↗
            </button>
        ) : blocked ? (
            <span className="text-[11px] font-semibold text-slate-400">{blocked}</span>
        ) : (
            <button type="button" onClick={onAct} disabled={busy}
                className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-primary-50 border border-primary-200 text-primary-700 hover:bg-primary-100 disabled:opacity-50">
                {busy ? 'Working…' : actLabel}
            </button>
        )}
    </div>
);

const LABEL_CLS = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5';
const INPUT_CLS = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm';

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
    site:      { label: 'SITE',    color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    unit:      { label: 'UNIT',    color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    system:    { label: 'SYSTEM',  color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    equipment: { label: 'EQUIP',   color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    subunit:   { label: 'SUBUNIT', color: 'text-primary-700', bg: 'bg-primary-50', border: 'border-primary-200' },
    component: { label: 'COMP',    color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    location:  { label: 'LOC',     color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
};

// ── Main Component ───────────────────────────────────────────
export function RCAInvestigationPage() {
    const { investigationId } = useParams<{ investigationId: string }>();
    const navigate = useNavigate();
    const { user, profile, permissions, role } = useAuth() as any;
    const currentUserId = user?.id || profile?.id || 'system';
    const currentUsername = profile?.username || user?.email || 'system';
    const isNew = !investigationId || investigationId === 'new';

    // Core state
    const [inv, setInv] = useState<RCAInvestigation | null>(null);
    const [nodes, setNodes] = useState<RCANode[]>([]);
    const [evidence, setEvidence] = useState<RCAEvidence[]>([]);
    // Node ↔ evidence links (0217) — what makes each cause claim citable.
    const [evLinks, setEvLinks] = useState<RCANodeEvidenceLink[]>([]);
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

    /**
     * Diagnose → Decide. A root cause the investigation has established is a
     * failure mode the asset's RCM study should analyse; without this edge the
     * study stays a binder. Adds the mode under the study's primary function,
     * or opens a seeded New Study when the asset has none.
     */
    const [addingToRcm, setAddingToRcm] = useState(false);
    const handleAddToRcmStudy = async () => {
        const assetId = inv?.asset_id || draft.asset_id;
        if (!assetId) { showToast('Link the investigation to an asset first', 'error'); return; }
        setAddingToRcm(true);
        try {
            const rootCauses = nodes.filter(n => n.is_root_cause || n.node_type === 'root_cause');
            const modeText = (inv?.event_what || inv?.problem_statement || inv?.title || '').trim();
            const causeText = rootCauses.map(n => n.description).join('; ') || inv?.root_cause_summary || '';
            const asset = allHierarchyAssets.find(a => a.id === assetId);
            const studies = await rcmService.getStudiesForAsset(assetId);
            const study = studies.find(st => st.status !== 'closed' && st.status !== 'approved') || studies.find(st => st.status !== 'closed');
            if (!study) {
                navigate('/rcm', { state: { seed: { asset: { id: assetId, name: asset?.name, tag: asset?.tag } } } });
                return;
            }
            if (study.status === 'approved') {
                showToast(`Study "${study.title}" is approved — choose Revise on it, then add the failure mode`, 'error');
                navigate(`/rcm/${study.id}`);
                return;
            }
            const fns = await rcmService.getFunctions(study.id);
            if (fns.length === 0) { navigate(`/rcm/${study.id}`); return; }
            const fn = fns.find(f => f.function_type === 'primary') || fns[0];
            const existing = await rcmService.getFailureModesByStudy(study.id);
            const dup = existing.find(m => modeText && m.failure_mode_description?.trim().toLowerCase() === modeText.toLowerCase());
            if (dup) { showToast('This failure mode is already in the study'); navigate(`/rcm/${study.id}`); return; }
            // Pin the mode to the component its text names, when the register has one.
            const breakdown = await rcmService.getAssetBreakdown(study.asset_id);
            const created = await rcmService.createFailureMode(pinFailureMode({
                function_id: fn.id,
                failure_mode_description: modeText || `Failure investigated in RCA ${inv?.id?.slice(0, 8) || ''}`.trim(),
                failure_cause_description: causeText || null,
                data_source: 'wo_history',
                sort_order: existing.filter(m => m.function_id === fn.id).length + 1,
            }, breakdown));
            if (created) { showToast(`Added to RCM study "${study.title}" — classify its consequence on the Worksheet`); navigate(`/rcm/${study.id}`); }
            else showToast('Could not add the failure mode to the study', 'error');
        } finally {
            setAddingToRcm(false);
        }
    };

    /**
     * Diagnose → FMEA. The established failure mode, its cause and effect, scored
     * from the investigation's own facts, become a row on the asset's FMEA worksheet.
     * Corrective actions ride along as the recommended action.
     */
    const [addingToFmea, setAddingToFmea] = useState(false);
    const handleAddToFmea = async () => {
        const assetId = inv?.asset_id || draft.asset_id;
        if (!assetId || !inv) { showToast('Link the investigation to a register asset first', 'error'); return; }
        setAddingToFmea(true);
        try {
            const asset = allHierarchyAssets.find(a => a.id === assetId);
            // A failure mode is "component + how it failed", not the component alone.
            const modeText = (inv.event_what && inv.event_how
                ? `${inv.event_what} — ${inv.event_how}`
                : inv.event_how || inv.event_what || inv.problem_statement || inv.title || '').trim();
            const rootCauses = nodes.filter(n => n.is_root_cause || n.node_type === 'root_cause');
            const causeText = rootCauses.map(n => n.description).join('; ') || inv.root_cause_summary || '';
            const sheets = await analyzeService.getFMEAWorksheets(assetId);
            let ws = sheets.find(w => w.status !== 'closed') || null;
            if (!ws) {
                ws = await analyzeService.createFMEAWorksheet({
                    asset_id: assetId, title: `FMEA — ${asset?.tag || 'asset'}`, fmea_type: 'equipment', status: 'draft',
                    max_rpn: 0, avg_rpn: 0, high_risk_count: 0,
                } as any);
            }
            if (!ws) { showToast('Could not open an FMEA worksheet for this asset', 'error'); return; }
            const items = await analyzeService.getFMEAItems(ws.id);
            if (items.some(i => i.failure_mode.trim().toLowerCase() === modeText.toLowerCase())) {
                showToast('This failure mode is already on the worksheet'); navigate(`/analyze/fmea/${ws.id}`); return;
            }
            // Function text: the RCM primary function when a study exists, else a plain statement.
            let fnText = `Primary function of ${asset?.tag || 'the asset'}`;
            try {
                const studies = await rcmService.getStudiesForAsset(assetId);
                const st = studies.find(x => x.status !== 'closed');
                if (st) {
                    const fns = await rcmService.getFunctions(st.id);
                    const primary = fns.find(f => f.function_type === 'primary') || fns[0];
                    if (primary?.function_description) fnText = primary.function_description;
                }
            } catch { /* optional context */ }
            const hm = (inv.event_how_much as any) || {};
            // Detection from what watches the asset; owner and date from the first owned action.
            const det = fmeaDetection(await analyzeService.getAssetDetectionControls(assetId).catch(() => ({ readingPoints: 0, activePms: 0 })));
            const owned = actions.find(a => isAssigned(a) && a.status !== 'cancelled');
            const dueDates = actions.map(a => a.due_date).filter((d): d is string => !!d).sort();
            const created = await analyzeService.createFMEAItem({
                worksheet_id: ws.id,
                component: inv.event_what || asset?.tag || 'Asset',
                function: fnText,
                failure_mode: modeText || `Failure investigated in RCA ${inv.id.slice(0, 8)}`,
                failure_effect: inv.problem_statement || null,
                failure_cause: causeText || null,
                severity: fmeaSeverity({ safetyTier: hm.safety_tier, criticality: formAssetDetail?.criticality, envImpact: hm.env_impact }),
                occurrence: fmeaOccurrence({ priorRcaCount: relatedRCAs.length, cmCount12mo: formAssetTrends?.totalCM }),
                detection: det.detection,
                current_controls: det.controls,
                recommended_action: actions.length ? actions.map(a => a.action_description).join('; ') : null,
                action_status: 'open',
                owner: owned?.assigned_to || null,
                owner_id: owned?.assignee_id || null,
                due_date: dueDates[0] || null,
            } as any);
            if (created) { showToast(`Added to FMEA worksheet "${ws.title}"`); navigate(`/analyze/fmea/${ws.id}`); }
            else showToast('Could not add the FMEA item', 'error');
        } finally { setAddingToFmea(false); }
    };

    // ── "Prevent the next one" hand-off state (step 4) ──────────────────
    // Done means THIS investigation's failure mode is on the study / worksheet,
    // or a DE task was born from this RCA — not merely that a study exists.
    const [handoffs, setHandoffs] = useState<{
        rcm: { id: string; title: string } | null;
        fmea: { id: string; title: string } | null;
        de: { id: string; title: string } | null;
    }>({ rcm: null, fmea: null, de: null });
    const [handoffTick, setHandoffTick] = useState(0);
    useEffect(() => {
        if (activeStep !== 4 || !inv) return;
        let cancelled = false;
        (async () => {
            const assetId = inv.asset_id;
            const modeText = (inv.event_what || inv.problem_statement || inv.title || '').trim().toLowerCase();
            const [studies, sheets, de] = await Promise.all([
                assetId ? rcmService.getStudiesForAsset(assetId).catch(() => []) : Promise.resolve([]),
                assetId ? analyzeService.getFMEAWorksheets(assetId).catch(() => []) : Promise.resolve([]),
                analyzeService.getDETaskForRca(inv.id).catch(() => null),
            ]);
            let rcm: { id: string; title: string } | null = null;
            for (const st of studies.filter(x => x.status !== 'closed')) {
                const modes = await rcmService.getFailureModesByStudy(st.id).catch(() => []);
                if (modes.some(m => (m.failure_mode_description || '').trim().toLowerCase() === modeText)) { rcm = { id: st.id, title: st.title }; break; }
            }
            let fmea: { id: string; title: string } | null = null;
            for (const ws of sheets.filter(x => x.status !== 'closed')) {
                const items = await analyzeService.getFMEAItems(ws.id).catch(() => []);
                if (items.some(i => i.failure_mode.trim().toLowerCase().startsWith(modeText.split(' — ')[0]))) { fmea = { id: ws.id, title: ws.title }; break; }
            }
            if (!cancelled) setHandoffs({ rcm, fmea, de: de ? { id: de.id, title: de.title } : null });
        })();
        return () => { cancelled = true; };
    }, [activeStep, inv?.id, inv?.asset_id, inv?.event_what, inv?.problem_statement, inv?.title, handoffTick]);
    // A repeat failure is what a DE task is for; a one-off is not.
    const isRepeatFailure = relatedRCAs.length > 0 || inv?.trigger_type === 'recurrence' || inv?.trigger_type === 'pareto';

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
        evidenceConfidence: null as number | null,
    });

    // Draft state for new investigations
    const [draft, setDraft] = useState({
        title: '', asset_id: '', asset_ref: '',
        rca_category: 'asset_failure' as string,
        investigation_type: 'reactive' as string,
        trigger_type: 'manual' as string,
        problem_statement: '', event_what: '', event_how: '',
        event_location: '', event_date: new Date().toISOString().split('T')[0],
        event_how_much: { cost: 0, downtime_hrs: 0, safety_tier: '', env_impact: '' },
    });
    // Impact fields live behind one disclosure; it opens itself once any of them holds a value.
    const [impactOpen, setImpactOpen] = useState(false);
    // Registered subunits / components of the linked asset, offered as suggestions for
    // "Failed component" so the text lines up with the register (and pins in RCM later).
    const [componentOptions, setComponentOptions] = useState<string[]>([]);
    const [formError, setFormError] = useState<string | null>(null);

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
            const [invData, nodesData, evData, actData, barData, teamData, logData, taxData, linkData] = await Promise.all([
                analyzeService.getRCAInvestigations().then(list => list.find(r => r.id === id) || null),
                analyzeService.getRCANodes(id),
                analyzeService.getRCAEvidence(id),
                analyzeService.getRCACorrectiveActions(id),
                analyzeService.getRCABarriers(id),
                analyzeService.getRCATeamMembers(id),
                analyzeService.getRCAAuditLog(id),
                analyzeService.getCauseTaxonomy(),
                analyzeService.getNodeEvidenceLinks(id),
            ]);
            if (invData) {
                setInv(invData);
                setRcaCollaborators(invData.collaborators || []);
                setActiveStep(invData.current_step || 1);
                setDraft(d => ({
                    ...d, title: invData.title, asset_id: invData.asset_id || '',
                    asset_ref: invData.asset_ref || '',
                    rca_category: invData.rca_category || 'asset_failure',
                    investigation_type: invData.investigation_type || 'reactive',
                    trigger_type: invData.trigger_type || 'manual',
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
            setTaxonomy(taxData); setEvLinks(linkData);
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
                trigger?: string;
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
                        trigger_type: state.trigger || d.trigger_type,
                        event_how_much: newHowMuch,
                        event_date: new Date().toISOString().split('T')[0],
                    };
                });
            }
        }
    }, [isNew, location.state]);

    // The "title and statement" nudge clears itself as soon as both are present.
    useEffect(() => {
        if (formError && draft.title.trim() && draft.problem_statement.trim()) setFormError(null);
    }, [formError, draft.title, draft.problem_statement]);

    useEffect(() => {
        const hm = draft.event_how_much || {};
        if (hm.cost || hm.downtime_hrs || hm.safety_tier || hm.env_impact) setImpactOpen(true);
    }, [draft.event_how_much]);

    // ── Load EAM Asset context card when asset changes ──
    useEffect(() => {
        if (!draft.asset_id) {
            setFormAssetDetail(null);
            setFormAssetTrends(null);
            setComponentOptions([]);
            return;
        }
        rcmService.getAssetBreakdown(draft.asset_id)
            .then(b => setComponentOptions(Array.from(new Set([
                ...b.components.map(c => [c.tag, c.name].filter(Boolean).join(' — ')),
                ...b.parts.map(p => (p as any).name || (p as any).description || '').filter(Boolean),
            ].filter(Boolean)))))
            .catch(() => setComponentOptions([]));
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
    const handleSave = useCallback(async (): Promise<boolean> => {
        if (isNew && (!draft.title.trim() || !draft.problem_statement.trim())) {
            setFormError('Give the investigation a title and a problem statement before saving.');
            return false;
        }
        setFormError(null);
        setSaving(true);
        let ok = false;
        try {
            if (isNew) {
                const created = await analyzeService.createRCAInvestigation({
                    // asset_id is nullable (0117) and has an FK to assets. The old
                    // all-zero placeholder matched no asset row, so every unlinked
                    // investigation was rejected with a 23503 and never saved.
                    asset_id: draft.asset_id || null,
                    asset_ref: draft.asset_id ? null : (draft.asset_ref.trim() || null),
                    title: draft.title || 'Untitled Investigation',
                    // No method at creation. It is chosen at the step-3 gate, once the
                    // evidence is in — picking one here would be picking before looking.
                    method: null, status: 'draft',
                    problem_statement: draft.problem_statement,
                    root_cause_summary: null,
                    rca_category: draft.rca_category as any,
                    investigation_type: draft.investigation_type as any,
                    trigger_type: draft.trigger_type as any, trigger_reference_id: null,
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
                    ok = true;
                    navigate(`/analyze/rca/${created.id}`, { replace: true });
                } else {
                    showToast('Could not save the investigation — please try again (check the console for details).', 'error');
                }
            } else if (inv) {
                await analyzeService.updateRCAInvestigation(inv.id, {
                    title: draft.title, problem_statement: draft.problem_statement,
                    asset_id: draft.asset_id || null,
                    asset_ref: draft.asset_id ? null : (draft.asset_ref.trim() || null),
                    // `method` is deliberately absent: it is owned by the step-3 gate.
                    // Writing it from this draft reverted a committed method back to the
                    // stale value the draft was loaded with every time step 1 was saved.
                    rca_category: draft.rca_category as any,
                    investigation_type: draft.investigation_type as any,
                    trigger_type: draft.trigger_type as any,
                    event_date: draft.event_date || null,
                    event_location: draft.event_location || null,
                    event_what: draft.event_what || null,
                    event_how: draft.event_how || null,
                    event_how_much: draft.event_how_much as any,
                    current_step: activeStep,
                } as any);
                await fetchAll(inv.id);
                ok = true;
            }
        } catch (e) { console.error('Save error:', e); }
        setSaving(false);
        return ok;
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

        // Evidence confidence: the weakest root cause carries the verdict.
        const conf = rootCauseConfidence(rootCauseNodes.map(n => n.id), evidence, evLinks);

        setDeDraft({
            title: `Defect Elimination: ${inv?.title || draft.title}`,
            rootCauseSummary,
            proposedSolution,
            annualCost,
            estimatedSavings: Math.round(annualCost * 0.75),
            implementationCost: 0,
            priority: annualCost > 100000 ? 'critical' : annualCost > 50000 ? 'high' : 'medium',
            evidenceConfidence: conf?.score ?? null,
        });
        setShowDEModal(true);
    }, [inv, draft, nodes, actions, evidence, evLinks]);

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
                evidence_confidence: deDraft.evidenceConfidence,
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
            setHandoffTick(t => t + 1);
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
    const [newEvGrade, setNewEvGrade] = useState<EvidenceQualityGrade | null>(null);

    // Files attached from the Add evidence dialog: photos, PDFs, logs, spreadsheets.
    const [newEvFiles, setNewEvFiles] = useState<File[]>([]);
    const [evSaving, setEvSaving] = useState(false);
    const [galleryReload, setGalleryReload] = useState(0);
    const evFileInputRef = useRef<HTMLInputElement>(null);
    const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(f.name);

    const addEvidence = async () => {
        if (!inv) return;
        const title = newEvTitle.trim() || newEvFiles[0]?.name || '';
        if (!title) return;
        setEvSaving(true);
        try {
            const db = DatabaseService.getInstance();
            const uploaderId = user?.id || profile?.id || null;
            // Every attachment becomes a file record (the gallery reads these) …
            const stored: { id: string; url: string; name: string; image: boolean }[] = [];
            for (const f of newEvFiles) {
                const url = await db.uploadImage(f, 'assets', 'rca_');
                const rec = await db.addEntityFile({
                    entityId: inv.id, entityType: 'RCA_INVESTIGATION', name: f.name, url,
                    type: f.type || 'application/octet-stream', sizeBytes: f.size, uploadedBy: uploaderId,
                });
                stored.push({ id: rec.id, url, name: f.name, image: isImage(f) });
            }
            // … each row's type follows its own attachment unless the user chose a specific type.
            const typeFor = (f?: { image: boolean }) =>
                f && newEvType === 'note' ? (f.image ? 'photo' : 'document') : newEvType;
            // One evidence row per attachment so each can be cited on its own; one row when nothing is attached.
            const rows = stored.length
                ? stored.map((f, i) => ({
                    title: stored.length > 1 ? `${title} (${i + 1}) — ${f.name}` : title,
                    content: [newEvContent.trim(), `Attached: ${f.name}`].filter(Boolean).join('\n'),
                    linked_entity_id: f.id,
                    type: typeFor(f),
                }))
                : [{ title, content: newEvContent || null, linked_entity_id: null, type: typeFor() }];
            const created: RCAEvidence[] = [];
            for (const r of rows) {
                const ev = await analyzeService.addRCAEvidence({
                    investigation_id: inv.id, evidence_type: r.type as any,
                    title: r.title, content: r.content,
                    linked_entity_id: r.linked_entity_id, event_timestamp: null, uploaded_by: currentUsername,
                    quality_grade: newEvGrade ?? (stored.length ? 'fact' : null),
                });
                if (ev) created.push(ev);
            }
            if (created.length) {
                setEvidence(e => [...e, ...created]);
                if (stored.some(x => x.image)) setGalleryReload(k => k + 1);
                setNewEvTitle(''); setNewEvContent(''); setNewEvGrade(null); setNewEvFiles([]);
                setAddEvidenceOpen(false);
            }
        } catch (e) {
            console.error('addEvidence:', e);
            showToast('Could not save the evidence — please try again.', 'error');
        } finally { setEvSaving(false); }
    };

    // ── Corrective Action management ─────────────────────────
    // Add-forms live in sheets, not stacked open at the bottom of each step.
    const [addEvidenceOpen, setAddEvidenceOpen] = useState(false);
    const [addActionOpen, setAddActionOpen] = useState(false);

    // Scroll target for "Change method" — the 5-Why escalation hint sits far below the gate.
    const methodGateRef = useRef<HTMLDivElement>(null);

    // The cause tool opens as a full-screen workspace (all four methods).
    const [causeFullscreen, setCauseFullscreen] = useState(false);
    // Live status of the work orders raised for actions — step 5 shows it beside each action.
    const [woStatuses, setWoStatuses] = useState<Record<string, { wo_number: string; status: string }>>({});
    useEffect(() => {
        const ids = actions.map(a => a.work_order_id).filter((x): x is string => !!x);
        if (ids.length === 0) { setWoStatuses({}); return; }
        analyzeService.getWorkOrderStatuses(ids).then(setWoStatuses);
    }, [actions]);
    // People an action can be assigned to: the RCA team first, then every active user.
    const [users, setUsers] = useState<Person[]>([]);
    useEffect(() => {
        DatabaseService.getInstance().getUsers()
            .then(us => setUsers(us.filter(u => u.status === 'active').map(u => ({ id: u.id, name: u.username || u.email, kind: 'user' as const }))))
            .catch(() => setUsers([]));
    }, []);
    const people = useMemo<Person[]>(() => {
        const team = rcaCollaborators.filter(c => c.type === 'contact').map(c => ({ id: c.ref_id, name: c.name, kind: 'contact' as const }));
        const seen = new Set(team.map(p => p.name.toLowerCase()));
        return [...team, ...users.filter(u => !seen.has(u.name.toLowerCase()))];
    }, [rcaCollaborators, users]);
    // MOC status per action — a change-controlled action may not raise work until approved.
    const [mocStatuses, setMocStatuses] = useState<Record<string, { moc_number: string; status: string }>>({});
    useEffect(() => {
        const ids = actions.map(a => a.moc_request_id).filter((x): x is string => !!x);
        if (ids.length === 0) { setMocStatuses({}); return; }
        analyzeService.getMocStatuses(ids).then(setMocStatuses);
    }, [actions]);
    const [raisingMoc, setRaisingMoc] = useState<string | null>(null);
    const handleRaiseMoc = async (a: RCACorrectiveAction) => {
        if (!inv) return;
        setRaisingMoc(a.id);
        try {
            const sel = allHierarchyAssets.find(x => x.id === inv.asset_id);
            const res = await analyzeService.raiseMocForAction({ action: a, investigation: inv, requestedBy: user?.id || null, assetLabel: sel ? `${sel.tag} — ${sel.name}` : inv.asset_ref });
            if (res) {
                setActions(acts => acts.map(x => x.id === a.id ? res.action : x));
                showToast('MOC raised as a draft — submit it from Change Control');
            }
        } finally { setRaisingMoc(null); }
    };
    // Fishbone has two views that each want the whole screen — the entry list, and the
    // diagram. One tap flips between them; state is shared so nothing is lost.
    const [fishboneView, setFishboneView] = useState<'causes' | 'diagram'>('causes');
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
    // The asset picker closes like any menu: click outside, Escape, or clear the text.
    const assetPickerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!showNewAssetDropdown) return;
        const onDown = (e: MouseEvent) => {
            if (assetPickerRef.current && !assetPickerRef.current.contains(e.target as Node)) setShowNewAssetDropdown(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNewAssetDropdown(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [showNewAssetDropdown]);

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
    const [newActionMoc, setNewActionMoc] = useState(false);
    const [newActionCause, setNewActionCause] = useState<string>('');
    const [newActionAssignee, setNewActionAssignee] = useState('');
    const [newActionDue, setNewActionDue] = useState('');

    const addAction = async () => {
        if (!inv || !newActionDesc.trim()) return;
        const owner = resolveAssignee(newActionAssignee, people);
        const assigneeId = owner?.id ?? null;
        const act = await analyzeService.addRCACorrectiveAction({
            investigation_id: inv.id,
            cause_node_id: newActionCause || (rootCauseNodes.length === 1 ? rootCauseNodes[0].id : null),
            cause_category: newActionCategory as any,
            action_description: newActionDesc.trim(),
            action_type: newActionType as any,
            assigned_to: owner?.name || null,
            assignee_id: assigneeId,
            due_date: newActionDue || null, status: 'open',
            requires_moc: newActionMoc, completion_date: null,
            completion_notes: null, risk_of_not_acting: null,
            work_order_id: null,
        } as any);
        if (act) {
            setActions(a => [...a, act]);
            // An action with an owner tells the owner. notify() resolves contact ids to users.
            if (assigneeId && assigneeId !== currentUserId) {
                NotificationService.notify({
                    recipientId: assigneeId,
                    title: `Corrective action assigned: ${inv.title}`,
                    message: `${newActionDesc.trim().slice(0, 160)}${newActionDue ? ` — due ${newActionDue}` : ''}`,
                    severity: 'INFO', notificationType: 'ASSIGNMENT', module: 'analyze',
                    entityId: inv.id, entityType: 'RCA_INVESTIGATION',
                    actionLink: `/analyze/rca/${inv.id}`, actionRequired: true, createdBy: currentUserId,
                }).catch(console.warn);
            }
            setNewActionDesc(''); setNewActionAssignee(''); setNewActionDue(''); setNewActionMoc(false); setNewActionCause('');
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
    // Credit-free method suggestion from facts already on the record (lib/rcaMethodSuggest).
    const methodSuggestion = useMemo(() => inv ? suggestRcaMethod({
        safetyTier: (inv.event_how_much as any)?.safety_tier,
        category: inv.rca_category,
        criticality: formAssetDetail?.criticality,
        priorRcaCount: relatedRCAs.length,
        triggerType: inv.trigger_type,
        cmCount12mo: formAssetTrends?.totalCM,
        evidenceTypes: evidence.map(e => e.evidence_type),
        problemText: inv.problem_statement,
    }) : null, [inv, formAssetDetail, relatedRCAs, formAssetTrends, evidence]);
    // NOTE: hook — must stay above the `if (loading)` early return.

    // Effectiveness can only be judged once the fixes are actually in place.
    const actionsSettled = settleActions(actions);

    // ── Who am I on this investigation? Mirrors rca_can_edit / rca_can_close (0332). ──
    const isAdminRole = ['SUPER_ADMIN', 'SYS_ADMIN'].includes(String(role || '').toUpperCase());
    const myTeamRole = useMemo(() => {
        const cid = profile?.contactId || profile?.contact_id;
        if (!cid) return null;
        const mine = rcaCollaborators.filter(c => c.type === 'contact' && c.ref_id === cid).map(c => c.role);
        const order = ['owner', 'editor', 'reviewer', 'viewer'];
        return mine.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] || null;
    }, [rcaCollaborators, profile]);
    const isCreator = !!inv && !!user?.id && (inv as any).created_by === user.id;
    const canEdit = isNew
        ? (isAdminRole || permissions?.reliability?.create === true || permissions?.reliability?.edit === true)
        : (isAdminRole || permissions?.reliability?.edit === true || isCreator || myTeamRole === 'owner' || myTeamRole === 'editor');
    const canClose = isAdminRole || isCreator || myTeamRole === 'owner' || myTeamRole === 'reviewer';
    const closeWho = isAdminRole ? 'administrator' : isCreator ? 'investigation owner' : myTeamRole ? `team ${myTeamRole}` : null;
    const readOnly = !canEdit || inv?.status === 'closed';

    const stepDone = useMemo(() => getStepCompletion({
        hasProblemStatement: !!(inv?.problem_statement || draft.problem_statement || '').trim(),
        // Step 1 is defined when the statement exists and the event is anchored to
        // an asset or a named component.
        has5W2H: !!(draft.asset_id || draft.asset_ref.trim() || draft.event_what.trim()),
        evidenceCount: evidence.length,
        // "Target for FACTS": a pile of opinions/hearsay doesn't complete Collect.
        // Ungraded legacy items still pass, so old investigations don't regress.
        hasVerifiedEvidence: evidence.some(e =>
            !e.quality_grade || e.quality_grade === 'fact' || e.quality_grade === 'inference'),
        hasRootCause: scopeNodesToMethod(nodes, inv?.method)
            .some(n => n.is_root_cause || n.node_type === 'root_cause'),
        actionCount: actions.length,
        allActionsAssigned: actions.length > 0 && actions.every(isAssigned),
        effectivenessReviewed: !!inv?.effectiveness_status && inv.effectiveness_status !== 'pending',
    }), [inv, draft, evidence, nodes, actions]);

    if (loading) {
        return (
            <div className="bg-slate-50 min-h-screen p-6 md:p-8 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
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
    // Did the problem definition change after the method was committed? The 0332
    // audit trigger writes 'definition_updated' on title / statement / asset edits.
    const definitionChangedAfterCommit = !!inv?.method_locked_at && auditLog.some(l =>
        l.action === 'definition_updated' && new Date(l.created_at).getTime() > new Date(inv.method_locked_at as string).getTime());
    // Root causes the committed method established — what a corrective action must point at.
    const rootCauseNodes = scopedNodes.filter(n => n.is_root_cause || n.node_type === 'root_cause');
    // Causal steps (whys, causes, root causes) that cite no supporting evidence. The
    // 5-Why "therefore" test shows this inside the workspace; the sign-off must see it too.
    const assumedSteps = scopedNodes.filter(n => n.node_type !== 'problem' && n.node_type !== 'category'
        && nodeSupport(n.id, evidence, evLinks).supports.length === 0);
    const rootCauseUncited = rootCauseNodes.some(n => nodeSupport(n.id, evidence, evLinks).supports.length === 0);

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
            <div className="ers-page-wide space-y-6">
                
                {/* Header — sticks to the top. An RCA is a team exercise and the page is long;
                    Invite has to be reachable from wherever you are in it, not just from the
                    top of a six-step scroll. The negative top/x offsets cancel BOTH this
                    page's padding AND the AppLayout <main> padding (p-4 md:p-6) — sticky
                    pins at the scroll container's content box, so without them the band
                    floats 16/24px down and content peeks out above it. */}
                <div className="sticky -top-4 md:-top-6 z-20 -mx-8 sm:-mx-10 md:-mx-14 px-8 sm:px-10 md:px-14 pt-1 pb-4 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200/80
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
                                Diagnose
                            </button>
                        </nav>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                                {isNew ? 'New Investigation' : (inv?.title || 'Investigation')}
                            </h1>
                            <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border tracking-wide uppercase ${
                                inv?.status === 'closed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                inv?.status === 'review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-primary-50 text-primary-700 border-primary-200'
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
                                    className="px-3.5 py-2 text-xs font-bold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
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
                                        <div className="fixed left-2 right-2 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden py-1">
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
                            disabled={saving || readOnly}
                            title={readOnly ? 'View only' : undefined}
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                                </>
                            ) : 'Save'}
                        </button>
                    </div>
                </div>

                {/* Role banner: what this person may do here (0332 enforces it in the database too). */}
                {!canEdit && (
                    <div className="bg-slate-50 border border-slate-200 text-slate-600 px-4 py-3 rounded-xl flex items-start gap-3 text-xs">
                        <Lock size={15} className="text-slate-400 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold text-slate-700">View only.</span>{' '}
                            {isNew
                                ? 'Your role can read investigations but not open one — ask a reliability engineer or an administrator.'
                                : myTeamRole
                                    ? `You are on this team as ${myTeamRole}. Editing needs the owner or editor role, or reliability edit rights.`
                                    : 'You are not on this investigation\'s team. Ask the owner to add you as an editor.'}
                            {canClose && !canEdit && ' You may still record the effectiveness verdict and close it.'}
                        </div>
                    </div>
                )}

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
                                        ? 'border-primary-200/60 bg-primary-50/50 text-primary-700' 
                                        : done 
                                            ? 'border-transparent text-emerald-600 hover:text-emerald-700 hover:bg-slate-50/50' 
                                            : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50/80'
                                }`}
                            >
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                                    done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-400'
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
                    <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                        <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary-600" /> What happened?
                        </div>

                        {/* Order follows the incident narrative: which asset, when, what happened,
                            then which part failed and how. The component is often unknown until
                            evidence arrives, so it sits after the statement and is optional. */}
                        <div className="space-y-4">
                            <div>
                                <label className={LABEL_CLS}>Title *</label>
                                <input
                                    className={`${INPUT_CLS} ${formError && !draft.title.trim() ? 'border-rose-300' : ''}`}
                                    value={draft.title}
                                    onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                                    placeholder="e.g. Premature seal failure — PMP-411"
                                />
                            </div>

                            <div>
                                <label className={LABEL_CLS}>Asset</label>
                                {draft.asset_id ? (
                                    <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                                        <Database size={16} className="text-primary-600 shrink-0" />
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
                                                setDraft(d => ({ ...d, asset_id: '', event_location: '' }));
                                                setFormAssetDetail(null);
                                                setFormAssetTrends(null);
                                            }}
                                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer shrink-0 ml-auto"
                                            aria-label="Unlink asset"
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                ) : draft.asset_ref ? (
                                    <div className="flex items-center gap-2.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 bg-slate-100 text-slate-600 border-slate-200">MANUAL</span>
                                        <span className="text-sm text-slate-900 font-bold truncate">{draft.asset_ref}</span>
                                        <span className="text-xs text-slate-400 hidden sm:inline">not in the register</span>
                                        <button
                                            onClick={() => { setDraft(d => ({ ...d, asset_ref: '' })); setNewAssetSearch(''); }}
                                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer shrink-0 ml-auto"
                                            aria-label="Clear asset"
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative" ref={assetPickerRef}>
                                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            value={newAssetSearch}
                                            onChange={e => { setNewAssetSearch(e.target.value); setShowNewAssetDropdown(true); }}
                                            onFocus={() => setShowNewAssetDropdown(true)}
                                            onKeyDown={e => {
                                                // Enter keeps what was typed when nothing in the register matches it.
                                                if (e.key === 'Enter' && newAssetSearch.trim()) {
                                                    e.preventDefault();
                                                    setDraft(d => ({ ...d, asset_ref: newAssetSearch.trim() }));
                                                    setShowNewAssetDropdown(false);
                                                }
                                            }}
                                            placeholder={hasEAMAssets ? 'Search the register, or type the asset and press Enter' : 'Type the asset tag or name'}
                                            className={`${INPUT_CLS} pl-9 pr-9 py-2.5`}
                                        />
                                        {(newAssetSearch || showNewAssetDropdown) && (
                                            <button
                                                type="button"
                                                onClick={() => { setNewAssetSearch(''); setShowNewAssetDropdown(false); }}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
                                                aria-label="Close"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                        {showNewAssetDropdown && (hasEAMAssets || newAssetSearch.trim()) && (
                                            <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                                {newAssetSearch.trim() && (
                                                    <button
                                                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50/60 transition-colors text-left cursor-pointer border-b border-slate-100"
                                                        onClick={() => {
                                                            setDraft(d => ({ ...d, asset_ref: newAssetSearch.trim() }));
                                                            setShowNewAssetDropdown(false);
                                                        }}
                                                    >
                                                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 bg-slate-100 text-slate-600 border-slate-200">MANUAL</span>
                                                        <span className="text-xs text-slate-900 font-bold truncate">Use “{newAssetSearch.trim()}” as typed</span>
                                                        <span className="text-[10px] text-slate-400 shrink-0 ml-auto">not in the register</span>
                                                    </button>
                                                )}
                                                {hasEAMAssets && filteredHierarchyAssets.length === 0 && (
                                                    <div className="p-4 text-center text-xs text-slate-400 font-medium">No register match</div>
                                                )}
                                                {filteredHierarchyAssets.map(a => {
                                                    const badge = TAXONOMY_BADGES[a.taxonomy_level] || TAXONOMY_BADGES.equipment;
                                                    return (
                                                        <button
                                                            key={a.id}
                                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left cursor-pointer border-b border-slate-100/60 last:border-0"
                                                            onClick={() => {
                                                                // The asset is the asset; the failed component is a
                                                                // separate question, so its tag is NOT copied there.
                                                                setDraft(d => ({ ...d, asset_id: a.id, asset_ref: '' }));
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

                                    {/* Asset context: location, criticality, recent work. This is where the
                                        functional location lives now — it is not asked for a second time. */}
                                    {formAssetLoading ? (
                                        <div className="flex items-center gap-2 p-3 text-xs font-semibold text-slate-500">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" /> Loading asset context…
                                        </div>
                                    ) : formAssetDetail ? (
                                        <div className="mt-2.5 bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-3 space-y-2">
                                            {formAssetDetail.breadcrumb?.length > 0 && (
                                                <div className="flex items-center gap-1.5 flex-wrap text-xs font-semibold text-slate-500">
                                                    <MapPin size={12} className="text-primary-600 shrink-0" />
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
                                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600">
                                                {(() => {
                                                    const cc = (formAssetDetail.criticality || 'C').toUpperCase();
                                                    const ccStyle = cc === 'A' ? 'bg-red-50 text-red-700 border-red-200' : cc === 'B' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-primary-50 text-primary-700 border-primary-200';
                                                    const label = cc === 'A' ? 'Safety Critical' : cc === 'B' ? 'Production Critical' : cc === 'C' ? 'Standard' : 'Low';
                                                    return (
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-extrabold ${ccStyle}`}>
                                                            <Shield size={10} strokeWidth={2.5} /> {cc} — {label}
                                                        </span>
                                                    );
                                                })()}
                                                <span className="font-medium">
                                                    {formAssetDetail.equipment_type || 'Equipment'}
                                                    {formAssetDetail.manufacturer ? ` · ${formAssetDetail.manufacturer}` : ''}
                                                    {formAssetDetail.model ? ` ${formAssetDetail.model}` : ''}
                                                </span>
                                                {formAssetTrends && (formAssetTrends.totalCM + formAssetTrends.totalPM) > 0 && (
                                                    <span className="flex items-center gap-1 font-medium">
                                                        <span className="text-slate-300">│</span>
                                                        <Wrench size={12} className="text-slate-400" /> {formAssetTrends.totalCM + formAssetTrends.totalPM} WOs
                                                        <span className="text-rose-600 font-semibold">({formAssetTrends.totalCM} CM)</span>
                                                        {formAssetTrends.totalCost > 0 && (
                                                            <span className="font-semibold text-slate-700 ml-1">
                                                                · ${formAssetTrends.totalCost >= 1e3 ? `${(formAssetTrends.totalCost / 1e3).toFixed(1)}K` : formAssetTrends.totalCost.toFixed(0)} (12mo)
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div>
                                    <label className={LABEL_CLS}>Event date</label>
                                    <input
                                        className={INPUT_CLS}
                                        type="date"
                                        value={draft.event_date}
                                        onChange={e => setDraft(d => ({ ...d, event_date: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL_CLS}>Type</label>
                                    <div className="flex rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden" role="radiogroup">
                                        {([['reactive', 'Reactive'], ['proactive', 'Proactive']] as const).map(([v, l]) => (
                                            <button
                                                key={v}
                                                type="button"
                                                role="radio"
                                                aria-checked={draft.investigation_type === v}
                                                onClick={() => setDraft(d => ({ ...d, investigation_type: v }))}
                                                title={v === 'reactive' ? 'After a failure' : 'Near-miss or risk-based, before a failure'}
                                                className={`flex-1 px-3 py-2 text-xs font-bold transition-colors cursor-pointer ${
                                                    draft.investigation_type === v
                                                        ? 'bg-primary-50 text-primary-700'
                                                        : 'text-slate-500 hover:bg-slate-50'
                                                }`}
                                            >
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className={LABEL_CLS}>Category</label>
                                    <select
                                        className={`${INPUT_CLS} cursor-pointer`}
                                        value={draft.rca_category}
                                        onChange={e => setDraft(d => ({ ...d, rca_category: e.target.value }))}
                                    >
                                        {RCA_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label.replace('-based', '')}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className={LABEL_CLS}>Trigger</label>
                                    <select
                                        className={`${INPUT_CLS} cursor-pointer`}
                                        value={draft.trigger_type}
                                        onChange={e => setDraft(d => ({ ...d, trigger_type: e.target.value }))}
                                        title="What started this investigation — a repeat, a bad-actor ranking, a cost or safety threshold, or a decision"
                                    >
                                        <option value="manual">Decision</option>
                                        <option value="pareto">Pareto / bad actor</option>
                                        <option value="recurrence">Repeat failure</option>
                                        <option value="downtime">Downtime threshold</option>
                                        <option value="cost">Cost threshold</option>
                                        <option value="safety">Safety event</option>
                                        <option value="near_miss">Near miss</option>
                                        <option value="criticality">Criticality review</option>
                                    </select>
                                </div>
                            </div>

                            {/* Location is asked only when there is no asset to derive it from. */}
                            {!draft.asset_id && (
                                <div>
                                    <label className={LABEL_CLS}>Location</label>
                                    <input
                                        className={INPUT_CLS}
                                        value={draft.event_location}
                                        onChange={e => setDraft(d => ({ ...d, event_location: e.target.value }))}
                                        placeholder="e.g. Site A › Unit 1 › Cooling water system"
                                    />
                                </div>
                            )}

                            <div>
                                <label className={LABEL_CLS}>Problem statement *</label>
                                <textarea
                                    className={`${INPUT_CLS} min-h-[90px] resize-y ${formError && !draft.problem_statement.trim() ? 'border-rose-300' : ''}`}
                                    value={draft.problem_statement}
                                    onChange={e => setDraft(d => ({ ...d, problem_statement: e.target.value }))}
                                    placeholder="What happened, what was seen, and in what order. Facts only — causes come later."
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={LABEL_CLS}>Failed component</label>
                                    <input
                                        className={INPUT_CLS}
                                        list={componentOptions.length ? 'rca-component-options' : undefined}
                                        value={draft.event_what}
                                        onChange={e => setDraft(d => ({ ...d, event_what: e.target.value }))}
                                        placeholder={componentOptions.length ? 'Pick from the asset breakdown or type' : 'e.g. Mechanical seal, carbon face'}
                                    />
                                    {componentOptions.length > 0 && (
                                        <datalist id="rca-component-options">
                                            {componentOptions.map(c => <option key={c} value={c} />)}
                                        </datalist>
                                    )}
                                </div>
                                <div>
                                    <label className={LABEL_CLS}>How it failed</label>
                                    <input
                                        className={INPUT_CLS}
                                        value={draft.event_how}
                                        onChange={e => setDraft(d => ({ ...d, event_how: e.target.value }))}
                                        placeholder="e.g. Thermal cracking and chipping along the face"
                                    />
                                </div>
                            </div>

                            {/* Impact is one disclosure, not four always-on fields. It opens itself when
                                a work order already brought downtime or cost with it. */}
                            <div className="border-t border-slate-100 pt-3">
                                {!impactOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setImpactOpen(true)}
                                        className="text-xs font-bold text-primary-700 hover:text-primary-800 inline-flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <Plus size={13} strokeWidth={2.5} /> Add impact
                                        <span className="font-medium text-slate-400">— downtime, cost, safety, environment</span>
                                    </button>
                                ) : (
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div>
                                            <label className={LABEL_CLS}>Downtime (h)</label>
                                            <input
                                                className={INPUT_CLS}
                                                type="number" min={0}
                                                value={draft.event_how_much.downtime_hrs || ''}
                                                onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, downtime_hrs: Number(e.target.value) } }))}
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLS}>Cost ($)</label>
                                            <input
                                                className={INPUT_CLS}
                                                type="number" min={0}
                                                value={draft.event_how_much.cost || ''}
                                                onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, cost: Number(e.target.value) } }))}
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLS}>Safety</label>
                                            <select
                                                className={`${INPUT_CLS} cursor-pointer`}
                                                value={draft.event_how_much.safety_tier || ''}
                                                onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, safety_tier: e.target.value } }))}
                                            >
                                                <option value="">None</option>
                                                <option value="tier_1">Tier 1 PSE</option>
                                                <option value="tier_2">Tier 2 PSE</option>
                                                <option value="lti">Lost time injury</option>
                                                <option value="first_aid">First aid case</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className={LABEL_CLS}>Environment</label>
                                            <select
                                                className={`${INPUT_CLS} cursor-pointer`}
                                                value={draft.event_how_much.env_impact || ''}
                                                onChange={e => setDraft(d => ({ ...d, event_how_much: { ...d.event_how_much, env_impact: e.target.value } }))}
                                            >
                                                <option value="">None</option>
                                                <option value="major">Major (uncontained spill)</option>
                                                <option value="minor">Minor (contained release)</option>
                                                <option value="permit_deviation">Permit deviation</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {formError && (
                                <div className="text-xs font-semibold text-rose-600 flex items-center gap-1.5">
                                    <AlertTriangle size={13} /> {formError}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── STEP 2: Collect Evidence ─────────────────────── */}
                {activeStep === 2 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <Database className="w-4 h-4 text-primary-600" /> Evidence Library & Data Log
                            </div>
                            
                            <div className="space-y-2">
                                {evidence.map(ev => (
                                    <div key={ev.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-all">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded border border-primary-200 bg-primary-50 text-primary-700 tracking-wide uppercase">{ev.evidence_type}</span>
                                            <EvidenceGradeBadge grade={ev.quality_grade} />
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
                                disabled={readOnly} onClick={() => setAddEvidenceOpen(true)}
                                className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-primary-200 text-primary-700 bg-primary-50/50 hover:bg-primary-50 font-bold text-xs transition-colors"
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
                                    readonly={readOnly}
                                    reloadKey={galleryReload}
                                    onImageAdded={async img => {
                                        // A photo of the scene is evidence — a fact — so it counts toward step 2.
                                        const ev = await analyzeService.addRCAEvidence({
                                            investigation_id: inv.id, evidence_type: 'photo',
                                            title: img.name, content: img.url, linked_entity_id: img.id,
                                            event_timestamp: null, uploaded_by: currentUsername, quality_grade: 'fact',
                                        });
                                        if (ev) setEvidence(e => [...e, ev]);
                                    }}
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
                            onOpenWorkspace={() => setCauseFullscreen(true)}
                            suggestion={methodSuggestion}
                            readOnly={readOnly}
                            definitionChangedAfterCommit={definitionChangedAfterCommit}
                            advisorSlot={
                                <button
                                    onClick={runMethodAdvisor}
                                    disabled={aiMethodLoading}
                                    title="AI recommends the best RCA method from the problem context, asset criticality and failure history. Advisory only — you decide."
                                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg border border-primary-200 bg-white text-primary-600 hover:bg-primary-50 hover:border-primary-300 shadow-xs transition-all disabled:opacity-60"
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
                            <div className="bg-white border border-primary-100 rounded-lg p-3 space-y-2">
                                <div className="flex items-center flex-wrap gap-2">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary-400">🤖 AI suggests</span>
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
                                        : aiMethodRec.confidence >= 0.7 ? 'bg-primary-100 text-primary-700'
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
                                        <Search className="w-4 h-4 text-primary-600 shrink-0" />
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
                                        className="w-full py-8 text-center text-slate-400 hover:text-primary-600 font-medium text-xs transition-colors"
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
                                                    <span className="min-w-0 flex-1">{n.description}</span>
                                                    {/* Evidence support at a glance — the Collect step made visible.
                                                        Root causes carry the full confidence verdict. */}
                                                    {(() => {
                                                        if (n.is_root_cause || n.node_type === 'root_cause') {
                                                            const conf = nodeConfidence(n.id, evidence, evLinks);
                                                            return (
                                                                <span
                                                                    className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full mt-0.5"
                                                                    style={{ background: conf.bg, color: conf.color }}
                                                                    title={`Evidence confidence ${conf.score}% — from cited evidence grades`}
                                                                >
                                                                    {conf.label} · {conf.score}%
                                                                </span>
                                                            );
                                                        }
                                                        const s = nodeSupport(n.id, evidence, evLinks);
                                                        return (
                                                            <span
                                                                className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full mt-0.5"
                                                                style={s.supports.length > 0
                                                                    ? { background: s.best?.bg ?? '#f1f5f9', color: s.best?.color ?? '#64748b' }
                                                                    : { background: '#fffbeb', color: '#b45309' }}
                                                                title={s.supports.length > 0
                                                                    ? `${s.supports.length} evidence item(s), best grade: ${s.best?.label ?? 'ungraded'}`
                                                                    : 'No evidence cited — assumed'}
                                                            >
                                                                {s.supports.length > 0 ? `${s.supports.length} ev` : 'assumed'}
                                                            </span>
                                                        );
                                                    })()}
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
                                <AlertTriangle size={16} className="text-primary-600" /> Causal Factor Identification
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
                                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-primary-200 bg-primary-50 text-primary-700 tracking-wide uppercase">
                                                {n.node_type === 'problem' ? 'PROBLEM' : n.node_type === 'why' ? `WHY ${n.depth}` : n.node_type.toUpperCase()}
                                            </span>
                                            {n.cause_category && (
                                                <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border tracking-wide uppercase ${
                                                    n.cause_category === 'physical' ? 'border-red-200 bg-red-50 text-red-700' :
                                                    n.cause_category === 'human' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                                                    'border-primary-200 bg-primary-50 text-primary-700'
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
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
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
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
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
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
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
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
                                        placeholder="Description of this Causal Event" 
                                        value={newNodeDesc} 
                                        onChange={e => setNewNodeDesc(e.target.value)} 
                                    />
                                </div>
                                <button 
                                    className="bg-primary-50 hover:bg-primary-100 border border-primary-200 text-primary-700 font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer text-xs lg:h-[38px] shrink-0"
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
                                    <Shield className="w-4 h-4 text-primary-600" /> Barrier Analysis (Defense-in-Depth)
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">Optional</span>
                                    {barriers.length > 0 && (
                                        <span className="text-[10px] font-bold text-primary-600 bg-primary-50 border border-primary-100 rounded-full px-2 py-0.5">{barriers.length}</span>
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
                                                    b.barrier_type === 'preventive' ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-amber-50 text-amber-700 border-amber-200'
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
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
                                            value={newBarrierType} 
                                            onChange={e => setNewBarrierType(e.target.value)}
                                        >
                                            {BARRIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Classification</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
                                            value={newBarrierClass} 
                                            onChange={e => setNewBarrierClass(e.target.value)}
                                        >
                                            {BARRIER_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness</label>
                                        <select 
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
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
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
                                        placeholder="Trips, training guidelines, mechanical containment, etc." 
                                        value={newBarrierDesc} 
                                        onChange={e => setNewBarrierDesc(e.target.value)} 
                                    />
                                </div>
                                <button 
                                    className="bg-primary-50 hover:bg-primary-100 border border-primary-200 text-primary-700 font-bold px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer text-xs lg:h-[38px] shrink-0"
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
                            investigationId={inv.id}
                        />
                    </div>
                )}

                {/* ── STEP 4: Develop Solutions ────────────────────── */}
                {activeStep === 4 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-4 flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-primary-600" /> Corrective actions
                            </div>
                            <p className="text-xs text-slate-400 font-medium mb-4">
                                <span className="font-bold text-slate-600">Fix this occurrence.</span>{' '}
                                One action per root cause, with an owner and a date. Actions against latent causes are the ones that stop recurrence.
                            </p>
                            {(() => {
                                const unaddressed = rootCauseNodes.filter(rc => !actions.some(a => a.cause_node_id === rc.id));
                                if (rootCauseNodes.length === 0) return (
                                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-4">No root cause has been established in step 3 yet — actions recorded now cannot be tied to one.</p>
                                );
                                if (unaddressed.length === 0) return null;
                                return (
                                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-4">
                                        {unaddressed.length} root cause{unaddressed.length === 1 ? ' has' : 's have'} no corrective action yet: {unaddressed.map(n => `“${n.description.slice(0, 60)}${n.description.length > 60 ? '…' : ''}”`).join(', ')}
                                    </p>
                                );
                            })()}
                            
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
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-bold text-slate-800">{a.action_description}</span>
                                                        {(() => {
                                                            const rc = a.cause_node_id ? nodes.find(n => n.id === a.cause_node_id) : null;
                                                            return rc
                                                                ? <div className="text-[11px] text-slate-500 mt-0.5 truncate" title={rc.description}>fixes: <span className="text-rose-700 font-semibold">{rc.description}</span></div>
                                                                : rootCauseNodes.length
                                                                    ? (
                                                                        <select
                                                                            className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 max-w-full cursor-pointer"
                                                                            value=""
                                                                            disabled={readOnly}
                                                                            title="Link this action to the root cause it fixes"
                                                                            onChange={async e => {
                                                                                const val = e.target.value; if (!val) return;
                                                                                const updated = await analyzeService.updateRCACorrectiveAction(a.id, { cause_node_id: val } as any);
                                                                                if (updated) setActions(acts => acts.map(x => x.id === a.id ? updated : x));
                                                                            }}
                                                                        >
                                                                            <option value="">not linked to a root cause — link it…</option>
                                                                            {rootCauseNodes.map(n => <option key={n.id} value={n.id}>{n.description.slice(0, 90)}</option>)}
                                                                        </select>
                                                                    )
                                                                    : <div className="text-[11px] text-amber-700 mt-0.5">not linked to a root cause</div>;
                                                        })()}
                                                    </div>
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
                                                            'bg-primary-50 text-primary-700 border-primary-200'
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
                                disabled={readOnly} onClick={() => setAddActionOpen(true)}
                                className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-dashed border-primary-200 text-primary-700 bg-primary-50/50 hover:bg-primary-50 font-bold text-xs transition-colors"
                            >
                                <Plus size={14} strokeWidth={2.5} /> Add corrective action
                            </button>
                        </div>

                        {/* Corrective actions fix this occurrence. These three change what stops the
                            next one, and each says whether it has been done for THIS failure. */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-3 flex items-center gap-2">
                                <Shield className="w-4 h-4 text-primary-600" /> Prevent the next one
                            </div>
                            <p className="text-xs text-slate-400 font-medium mb-4">
                                Hand the finding to the tools that decide what prevents recurrence. Each one opens the record it creates.
                                {!inv.asset_id && <span className="text-amber-700"> RCM and FMEA need a register asset on this investigation.</span>}
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <Handoff
                                    icon={<Wrench size={15} />}
                                    title="RCM study"
                                    purpose="Decide the maintenance task for this failure mode: on-condition, scheduled, redesign or run-to-failure."
                                    done={handoffs.rcm ? { label: `Open “${handoffs.rcm.title}”`, onOpen: () => navigate(`/rcm/${handoffs.rcm!.id}`) } : null}
                                    blocked={!inv.asset_id ? 'Needs a register asset' : null}
                                    busy={addingToRcm}
                                    actLabel="Add failure mode to RCM"
                                    onAct={() => void handleAddToRcmStudy()}
                                />
                                <Handoff
                                    icon={<ClipboardList size={15} />}
                                    title="FMEA worksheet"
                                    purpose="Record the risk: severity, occurrence and detection scored from this investigation's facts, with the actions as the recommendation."
                                    done={handoffs.fmea ? { label: `Open “${handoffs.fmea.title}”`, onOpen: () => navigate(`/analyze/fmea/${handoffs.fmea!.id}`) } : null}
                                    blocked={!inv.asset_id ? 'Needs a register asset' : null}
                                    busy={addingToFmea}
                                    actLabel="Add to FMEA"
                                    onAct={() => void handleAddToFmea()}
                                />
                                <Handoff
                                    icon={<Target size={15} />}
                                    title="Defect Elimination task"
                                    purpose="For a chronic defect only: track its elimination across every work order and RCA raised against it, with cost, savings and payback."
                                    done={handoffs.de ? { label: 'Open DE task', onOpen: () => navigate(`/analyze?division=defect_elimination&task=${handoffs.de!.id}`) } : null}
                                    blocked={!isRepeatFailure ? 'Not a repeat failure — no prior RCA or recurrence trigger on this asset' : null}
                                    actLabel="Create DE task"
                                    onAct={openDEModal}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── STEP 5: Implement ────────────────────────────── */}
                {activeStep === 5 && inv && (
                    <div className="space-y-6">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
                            <div className="text-sm sm:text-base font-extrabold text-slate-900 border-b border-slate-100 pb-3.5 mb-5 flex items-center gap-2">
                                <ClipboardList className="w-4 h-4 text-primary-600" /> Implementation Tracker
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center shadow-xs relative overflow-hidden">
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
                                    <div className="text-2xl md:text-3xl font-black text-emerald-600 mb-0.5">{actions.filter(a => a.status === 'completed').length}</div>
                                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Completed</div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center shadow-xs relative overflow-hidden">
                                    <div className="absolute top-0 left-0 right-0 h-1 bg-primary-500" />
                                    <div className="text-2xl md:text-3xl font-black text-primary-600 mb-0.5">{actions.filter(a => a.status === 'in_progress').length}</div>
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
                                    <span className="text-primary-600">{actions.length ? Math.round((actions.filter(a => a.status === 'completed').length / actions.length) * 100) : 0}%</span>
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
                                                'bg-primary-50 border-primary-200 text-primary-700'
                                            }`}>
                                                {a.cause_category}
                                            </span>
                                            <span className="text-sm font-bold text-slate-800">{a.action_description}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {/* Close the loop: corrective action → real work in Work Management */}
                                            {a.work_order_id ? (() => {
                                                const wo = woStatuses[a.work_order_id];
                                                const st = classifyWoStatus(wo?.status);
                                                const tone = st === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                                    : st === 'void' ? 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100';
                                                return (
                                                    <button
                                                        onClick={() => navigate(`/work-orders/${a.work_order_id}`)}
                                                        className={`px-2.5 py-1 text-[10px] font-extrabold rounded-md border transition-colors flex items-center gap-1 ${tone}`}
                                                        title="Open the linked work order — the action follows its status"
                                                    >
                                                        <Wrench size={10} /> {wo?.wo_number || 'WO'} · {wo?.status || '…'} ↗
                                                    </button>
                                                );
                                            })() : a.work_request_id ? (
                                                <button
                                                    onClick={() => navigate('/requests')}
                                                    className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition-colors flex items-center gap-1"
                                                    title="A maintenance request was raised; when it converts, the work order links here"
                                                >
                                                    <ClipboardList size={10} /> Request raised ↗
                                                </button>
                                            ) : (() => {
                                                const gate = mocGate(a, a.moc_request_id ? mocStatuses[a.moc_request_id]?.status : null);
                                                return (
                                                    <button
                                                        onClick={() => setRaiseAction(a)}
                                                        disabled={!gate.canRaiseWork}
                                                        className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={gate.reason || 'Raise a corrective Work Order or Maintenance Request for this action'}
                                                    >
                                                        <Plus size={10} /> Raise work
                                                    </button>
                                                );
                                            })()}
                                            {/* Change control: a flagged action raises an MOC and waits for approval. */}
                                            {a.requires_moc && (a.moc_request_id ? (() => {
                                                const m = mocStatuses[a.moc_request_id];
                                                const ok = m && ['APPROVED', 'IMPLEMENTED', 'CLOSED'].includes((m.status || '').toUpperCase());
                                                return (
                                                    <button
                                                        onClick={() => navigate(`/management-of-change/${a.moc_request_id}`)}
                                                        className={`px-2.5 py-1 text-[10px] font-extrabold rounded-md border transition-colors flex items-center gap-1 ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'}`}
                                                        title="Open the change request"
                                                    >
                                                        <Shield size={10} /> {m?.moc_number || 'MOC'} · {m?.status || '…'} ↗
                                                    </button>
                                                );
                                            })() : (
                                                <button
                                                    onClick={() => void handleRaiseMoc(a)}
                                                    disabled={raisingMoc === a.id}
                                                    className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                    title="This action changes the asset or how it is run — raise a management-of-change request"
                                                >
                                                    <Shield size={10} /> {raisingMoc === a.id ? 'Raising…' : 'Raise MOC'}
                                                </button>
                                            ))}
                                            {isAssigned(a) && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded" title="Owner">
                                                    <Users size={10} /> {a.assigned_to || 'assigned'}
                                                </span>
                                            )}
                                            <select
                                                className="w-full sm:w-36 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all cursor-pointer shadow-xs shrink-0"
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
                                <BarChart3 className="w-4 h-4 text-primary-600" /> Effectiveness Verification & Audit
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness Review Due Date</label>
                                    <input 
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
                                        type="date" 
                                        value={inv.effectiveness_due?.split('T')[0] || ''} 
                                        onChange={async e => {
                                            // Read the value BEFORE awaiting: a controlled select snaps back to state
                                            // on the re-render the await allows, so e.target.value is stale afterwards.
                                            const val = e.target.value;
                                            await analyzeService.updateRCAInvestigation(inv.id, { effectiveness_due: val } as any);
                                            setInv(i => i ? { ...i, effectiveness_due: val } : i);
                                        }} 
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Effectiveness Verification Status</label>
                                    {(assumedSteps.length > 0 || rootCauseUncited) && (
                                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-1.5">
                                            <span className="font-bold">Before signing off:</span>{' '}
                                            {rootCauseUncited ? 'the root cause cites no evidence' : `${assumedSteps.length} causal step${assumedSteps.length === 1 ? '' : 's'} cite no evidence`}
                                            {' '}— the chain reads as assumption. Open the step 3 workspace and cite what proves each step, or record why it was accepted in the summary below.
                                        </p>
                                    )}
                                    {rootCauseNodes.some(rc => !actions.some(a => a.cause_node_id === rc.id)) && (
                                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-1.5">
                                            A root cause has no corrective action linked to it (step 4).
                                        </p>
                                    )}
                                    {!actionsSettled && (
                                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-1.5">
                                            Verification opens once every corrective action is complete
                                            ({actions.filter(a => a.status === 'completed' || a.status === 'cancelled').length} of {actions.length}).
                                            {actions.length === 0 && ' Add at least one action in step 4.'}
                                        </p>
                                    )}
                                    <select
                                        disabled={!actionsSettled || !canClose}
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                        value={inv.effectiveness_status || 'pending'} 
                                        onChange={async e => {
                                            const val = e.target.value;
                                            const ok = await analyzeService.updateRCAInvestigation(inv.id, { effectiveness_status: val } as any);
                                            if (ok) setInv(i => i ? { ...i, effectiveness_status: val as any } : i);
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
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm min-h-[100px] resize-y"
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
                                <Clock size={16} className="text-primary-600" /> Audit Log History
                            </div>
                            
                            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                {auditLog.slice(0, 10).map(log => (
                                    <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100/50 transition-all text-xs text-slate-600">
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <span className="text-slate-400 font-bold shrink-0">{new Date(log.created_at).toLocaleString()}</span>
                                            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded border border-primary-100 bg-primary-50 text-primary-700 tracking-wide uppercase shrink-0">{log.action}</span>
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
                                    <div className="flex items-center gap-2 p-3 bg-primary-50/40 border border-primary-100 rounded-xl text-xs text-slate-600 mb-4 shrink-0">
                                        <Zap size={14} className="text-primary-600 shrink-0" />
                                        <span>Source Investigation:</span>
                                        <span className="font-bold text-primary-700 truncate max-w-[200px]">{inv?.title || draft.title}</span>
                                        <span className="ml-auto text-[9px] font-extrabold px-2 py-0.5 rounded border border-primary-200 bg-primary-50 text-primary-700 tracking-wide uppercase shrink-0">
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
                                                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
                                            />
                                        </div>

                                        {/* Root Cause Summary */}
                                        <div>
                                            <label className="block text-[10px] font-extrabold uppercase tracking-wider text-rose-500 mb-1 flex items-center gap-1.5">
                                                <AlertTriangle size={11} strokeWidth={2.5} /> Root Cause Summary
                                                {/* Evidence confidence — inherited from the RCA's citations */}
                                                {deDraft.evidenceConfidence != null && (() => {
                                                    const c = confidenceFromScore(deDraft.evidenceConfidence);
                                                    return (
                                                        <span className="ml-auto normal-case tracking-normal text-[9px] font-extrabold px-2 py-0.5 rounded-full"
                                                            style={{ background: c.bg, color: c.color }}
                                                            title="From the root cause's cited evidence grades — the weakest root cause carries the verdict">
                                                            Evidence: {c.label} · {c.score}%
                                                        </span>
                                                    );
                                                })()}
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
                                                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm cursor-pointer"
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
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm mt-1"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-extrabold text-emerald-600 tracking-wider">EST. SAVINGS ($)</label>
                                                <input 
                                                    type="number" 
                                                    value={deDraft.estimatedSavings}
                                                    onChange={e => setDeDraft(d => ({ ...d, estimatedSavings: Number(e.target.value) }))}
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm mt-1"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-extrabold text-amber-600 tracking-wider">IMPL. COST ($)</label>
                                                <input 
                                                    type="number" 
                                                    value={deDraft.implementationCost}
                                                    onChange={e => setDeDraft(d => ({ ...d, implementationCost: Number(e.target.value) }))}
                                                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm mt-1"
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
                            onClick={async () => { if (await handleSave()) goStep(activeStep + 1); }}
                        >
                            Next <ChevronRight size={15} strokeWidth={2.5} />
                        </button>
                    ) : (
                        (() => {
                            const verdictIn = !!inv?.effectiveness_status && inv.effectiveness_status !== 'pending';
                            const closed = inv?.status === 'closed';
                            const why = closed ? 'Already closed'
                                : !canClose ? 'Closing needs the investigation owner, a reviewer on its team, or an administrator'
                                : !verdictIn ? 'Record the effectiveness verdict first'
                                : `Sign off and close as ${closeWho}`;
                            return (
                                <div className="flex items-center gap-3">
                                    {!closed && <span className="text-[11px] text-slate-400 hidden sm:inline">{why}</span>}
                                    <button
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={closed || !canClose || !verdictIn}
                                        title={why}
                                        onClick={async () => {
                                            if (!inv) return;
                                            // The 0332 trigger enforces sign-off + verdict and writes the audit row.
                                            const ok = await analyzeService.updateRCAInvestigation(inv.id, { status: 'closed', closed_at: new Date().toISOString() } as any);
                                            if (ok) navigate('/analyze');
                                        }}
                                    >
                                        <CheckCircle2 size={15} strokeWidth={2.5} /> {closed ? 'Closed' : 'Sign off & close'}
                                    </button>
                                </div>
                            );
                        })()
                    )}
                </div>
            </div>

            {/* ══ CAUSE WORKSPACE — full screen ═══════════════════════════════════
                Every RCA tool is a diagram, and a diagram needs room. Fishbone alone wants
                ~980px of layout; inside the step column on a phone it was unusable. Here it
                gets the whole viewport, with the page's own chrome out of the way. */}
            {causeFullscreen && inv && methodCommitted && createPortal(
                <div
                    className="fixed inset-0 z-[80] bg-slate-900/45 backdrop-blur-[2px] flex items-center justify-center sm:p-4 md:p-6"
                    onMouseDown={e => { if (e.target === e.currentTarget) setCauseFullscreen(false); }}
                >
                <div
                    className="w-full h-full sm:w-[92vw] sm:max-w-[1400px] sm:h-[92vh] bg-slate-50 sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
                    role="dialog" aria-modal="true" aria-label="Cause analysis workspace"
                >
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
                            {/* Fishbone: flip between the entry list and the diagram, each full-screen. */}
                            {inv.method === 'fishbone' && (
                                <div className="flex bg-slate-100 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setFishboneView('causes')}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                            fishboneView === 'causes' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                                        }`}
                                    >Causes</button>
                                    <button
                                        onClick={() => setFishboneView('diagram')}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                            fishboneView === 'diagram' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                                        }`}
                                    >Diagram</button>
                                </div>
                            )}
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
                                problemStatement={inv.problem_statement}
                                onSummaryChange={summary => setInv(i => i ? { ...i, root_cause_summary: summary } : i)}
                                nodes={scopedNodes}
                                setNodes={setNodes}
                                evidence={evidence}
                                setEvidence={setEvidence}
                                links={evLinks}
                                setLinks={setEvLinks}
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
                                fishboneView={inv.method === 'fishbone' ? fishboneView : 'both'}
                                evidence={evidence}
                                setEvidence={setEvidence}
                                links={evLinks}
                                setLinks={setEvLinks}
                            />
                        )}
                    </div>
                </div>
                </div>,
                document.body,
            )}

            {/* ── Add evidence (step 2) ───────────────────────────────────────── */}
            <Modal
                open={addEvidenceOpen}
                onClose={() => { if (!evSaving) setAddEvidenceOpen(false); }}
                title={<div><div>Add evidence</div><div className="text-xs font-normal text-slate-500">What you found, where it came from, and the file that shows it</div></div>}
                size="xl"
                footer={
                    <div className="flex gap-2 justify-end">
                        <Button variant="secondary" onClick={() => setAddEvidenceOpen(false)} disabled={evSaving}>Cancel</Button>
                        <Button onClick={addEvidence} disabled={evSaving || (!newEvTitle.trim() && newEvFiles.length === 0)}>
                            {evSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : newEvFiles.length ? `Add ${newEvFiles.length} attachment${newEvFiles.length === 1 ? '' : 's'} as evidence` : 'Add evidence'}
                        </Button>
                    </div>
                }
            >
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <Field label="Evidence type">
                            <Select value={newEvType} onChange={e => setNewEvType(e.target.value)}>
                                <option value="note">Note</option>
                                <option value="photo">Photo</option>
                                <option value="document">Document</option>
                                <option value="work_order">Work Order</option>
                                <option value="fmea">FMEA</option>
                                <option value="sensor_data">Sensor Data</option>
                                <option value="timeline_event">Timeline Event</option>
                                <option value="interview">Interview</option>
                            </Select>
                        </Field>
                        <Field label="Title" hint={newEvFiles.length && !newEvTitle.trim() ? `Defaults to “${newEvFiles[0].name}”` : undefined}>
                            <Input
                                placeholder="Title / reference tag"
                                value={newEvTitle}
                                onChange={e => setNewEvTitle(e.target.value)}
                                autoFocus
                            />
                        </Field>
                        <Field label="Details" hint="What it shows, or a URL to the source">
                            <Textarea
                                rows={5}
                                placeholder="e.g. Seal face scored circumferentially; photo taken before disassembly"
                                value={newEvContent}
                                onChange={e => setNewEvContent(e.target.value)}
                            />
                        </Field>
                    </div>
                    <div className="space-y-4">
                        <Field label="Attach photo, media or file" hint="Images land in the photo gallery too. Each attachment becomes its own evidence item.">
                            <input
                                ref={evFileInputRef}
                                type="file"
                                multiple
                                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json,.log"
                                className="hidden"
                                onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) setNewEvFiles(cur => [...cur, ...fs]); e.target.value = ''; }}
                            />
                            <button
                                type="button"
                                onClick={() => evFileInputRef.current?.click()}
                                onDragOver={e => e.preventDefault()}
                                onDrop={e => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files || []); if (fs.length) setNewEvFiles(cur => [...cur, ...fs]); }}
                                className="w-full flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 text-slate-500 hover:border-primary-300 hover:bg-primary-50/40 hover:text-primary-700 transition-colors cursor-pointer"
                            >
                                <Upload size={18} />
                                <span className="text-xs font-bold">Choose files or drop them here</span>
                                <span className="text-[11px] text-slate-400">Photos, video, audio, PDF, spreadsheets, logs</span>
                            </button>
                            {newEvFiles.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {newEvFiles.map((f, i) => (
                                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs">
                                            {isImage(f) ? <img src={URL.createObjectURL(f)} alt="" className="w-7 h-7 rounded object-cover shrink-0" /> : <Paperclip size={13} className="text-slate-400 shrink-0" />}
                                            <span className="font-semibold text-slate-700 truncate flex-1">{f.name}</span>
                                            <span className="text-slate-400 shrink-0">{f.size >= 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1e3))} KB`}</span>
                                            <button type="button" onClick={() => setNewEvFiles(cur => cur.filter((_, j) => j !== i))} className="p-0.5 text-slate-400 hover:text-rose-600" aria-label="Remove">
                                                <X size={13} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Field>
                        <Field label="Data quality" hint={newEvFiles.length ? 'Attachments default to Fact — direct evidence' : 'Grade what this datum actually is — target for facts, verify opinions with higher-quality data'}>
                            <div className="space-y-1.5">
                                {EVIDENCE_GRADES.map(g => {
                                    const selected = (newEvGrade ?? (newEvFiles.length ? 'fact' : null)) === g.value;
                                    return (
                                        <button
                                            key={g.value}
                                            type="button"
                                            onClick={() => setNewEvGrade(newEvGrade === g.value ? null : g.value)}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all"
                                            style={{
                                                background: selected ? g.bg : '#fff',
                                                borderColor: selected ? `${g.color}60` : '#e2e8f0',
                                            }}
                                        >
                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.color, opacity: selected ? 1 : 0.4 }} />
                                            <span className="text-xs font-bold min-w-[96px]" style={{ color: selected ? g.color : '#475569' }}>{g.label}</span>
                                            <span className="text-[11px] leading-snug" style={{ color: selected ? g.color : '#94a3b8' }}>{g.caption}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>
                    </div>
                </div>
            </Modal>

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
                    <Field label="Which root cause does this fix?" hint={rootCauseNodes.length ? 'One action per root cause — this is how the link is kept.' : 'No root cause established yet (step 3). The action can still be recorded and linked later.'}>
                        <Select value={newActionCause || (rootCauseNodes.length === 1 ? rootCauseNodes[0].id : '')} onChange={e => setNewActionCause(e.target.value)} disabled={rootCauseNodes.length === 0}>
                            {rootCauseNodes.length !== 1 && <option value="">{rootCauseNodes.length ? '— choose a root cause —' : 'No root cause yet'}</option>}
                            {rootCauseNodes.map(n => <option key={n.id} value={n.id}>{n.description.length > 110 ? n.description.slice(0, 107) + '…' : n.description}</option>)}
                        </Select>
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
                    <Field label="Owner" hint="An action with no owner is a wish. The owner is notified.">
                        <Select value={newActionAssignee} onChange={e => setNewActionAssignee(e.target.value)}>
                            <option value="">— nobody yet —</option>
                            {people.some(p => p.kind === 'contact') && (
                                <optgroup label="Investigation team">
                                    {people.filter(p => p.kind === 'contact').map(p => <option key={`contact:${p.id}`} value={`contact:${p.id}`}>{p.name}</option>)}
                                </optgroup>
                            )}
                            <optgroup label="Users">
                                {people.filter(p => p.kind === 'user').map(p => <option key={`user:${p.id}`} value={`user:${p.id}`}>{p.name}</option>)}
                            </optgroup>
                        </Select>
                    </Field>
                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                        <input type="checkbox" className="mt-0.5" checked={newActionMoc} onChange={e => setNewActionMoc(e.target.checked)} />
                        <span className="text-xs text-slate-700">
                            <span className="font-bold">Requires management of change.</span>{' '}
                            This action changes the asset, a set-point, a procedure or the maintenance strategy.
                            Work cannot be raised for it until the change request is approved.
                        </span>
                    </label>
                </div>
            </Drawer>

            {showTeamPanel && (
                <TeamPanel
                    collaborators={rcaCollaborators}
                    onAdd={handleAddCollaborator}
                    onRemove={handleRemoveCollaborator}
                    onUpdateRole={handleUpdateCollaboratorRole}
                    onClose={() => setShowTeamPanel(false)}
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
                        woProperties={{ rca_id: inv.id, rca_action_id: raiseAction.id }}
                        onCreated={async (kind, id) => {
                            if (!id) return;
                            // WO: link now. REQUEST: remember it; the 0328 trigger links the WO when
                            // the planner converts it. PM: a strategy, not a one-off — note it and
                            // leave the action open for its first execution.
                            const patch = kind === 'WO'
                                ? { work_order_id: id, status: raiseAction.status === 'open' ? 'in_progress' : raiseAction.status }
                                : kind === 'REQUEST'
                                    ? { work_request_id: id }
                                    : { completion_notes: `PM strategy ${id} created for this action` };
                            const updated = await analyzeService.updateRCACorrectiveAction(raiseAction.id, patch as any);
                            if (updated) setActions(acts => acts.map(x => x.id === raiseAction.id ? updated : x));
                        }}
                        onClose={() => setRaiseAction(null)}
                    />
                );
            })()}
        </div>
    );
}

export default RCAInvestigationPage;
