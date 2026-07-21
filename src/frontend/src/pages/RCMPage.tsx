/**
 * RCMPage — Orchestration Shell
 * ══════════════════════════════
 * Thin shell that manages state and composes the decomposed RCM sub-components.
 * All visual rendering is delegated to components in /components/rcm/.
 *
 * Standards: SAE JA1011/JA1012, IEC 60300-3-11
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Shield, Plus, Search, ArrowLeft, LayoutList, Layers, GitBranch, Wrench,
  Users, Edit3, Trash2, Save, X, RefreshCw, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { ScrollTabStrip } from '../eam/components/ui';
import { rcmService } from '../eam/services/RCMService';
import type {
  RCMStudy, RCMFunction, RCMFailureMode, RCMDecision,
  RCMTaskSummary,
} from '../eam/services/RCMService';
import { TeamPanel, AvatarStack } from '../components/analyze/CollaboratorPicker';
import analyzeService from '../eam/services/AnalyzeService';
import type { StudyCollaborator } from '../eam/services/AnalyzeService';
import type { RCMLifeEvidence } from '../components/rcm/types';
import { useAuth } from '../contexts/AuthContext';
import { useAssetLookup } from '../hooks/useAssetLookup';

// Sub-components
import { RCMStudyDashboard } from '../components/rcm/RCMStudyDashboard';
import { RCMStudyOverview } from '../components/rcm/RCMStudyOverview';
import { RCMFunctionPanel } from '../components/rcm/RCMFunctionPanel';
import { RCMDecisionWizard } from '../components/rcm/RCMDecisionWizard';
import { RCMTaskMatrix } from '../components/rcm/RCMTaskMatrix';
import { RCMEvidencePanel } from '../components/rcm/RCMEvidencePanel';
import { CRIT_COLORS } from '../components/rcm/types';

// ── Types ─────────────────────────────────────────────────
type RCMTab = 'dashboard' | 'functions' | 'decisions' | 'tasks' | 'evidence';

const RCM_TABS: { id: RCMTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'dashboard', label: 'Overview', icon: <LayoutList size={16} />, desc: 'Study health' },
  { id: 'functions', label: 'Functions & Failures', icon: <Layers size={16} />, desc: 'Q1–Q5' },
  { id: 'decisions', label: 'Decision Logic', icon: <GitBranch size={16} />, desc: 'Q6–Q7' },
  { id: 'tasks', label: 'Task Output', icon: <Wrench size={16} />, desc: 'Recommendations' },
  { id: 'evidence', label: 'Evidence', icon: <Layers size={16} />, desc: 'Study vs data' },
];

// ── Main Page Component ───────────────────────────────────
export const RCMPage: React.FC = () => {
  const { studyId } = useParams<{ studyId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Drill-through seed (Metrics bad actor → RCM, or Weibull fit → RCM): open the
  // New Study form pre-filled with the flagged asset — and, when the seed carries
  // a Weibull fit, drop the life-data evidence into the operating context so the
  // study (and the AI suggesters) start from the measured failure pattern.
  const rcmSeed = (location.state as {
    seed?: {
      asset?: { id: string; name?: string; tag?: string };
      weibull?: { beta: number; eta: number; b10: number; interval: number; r2?: number };
    }
  } | null)?.seed ?? null;
  const rcmSeedAppliedRef = useRef(false);

  // ── Auth & Asset Lookup ────────────────────────────────
  const { permissions } = useAuth();
  const hasAssetAccess = useMemo(() => permissions?.assets?.view ?? false, [permissions]);
  const { assetOptions } = useAssetLookup();
  const [assetInputMode, setAssetInputMode] = useState<'search' | 'manual'>('search');
  const [editAssetInputMode, setEditAssetInputMode] = useState<'search' | 'manual'>('search');

  // If permissions load and user has no access, default to manual
  useEffect(() => {
    if (!hasAssetAccess) {
      setAssetInputMode('manual');
      setEditAssetInputMode('manual');
    }
  }, [hasAssetAccess]);

  // ── State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<RCMTab>(studyId ? 'functions' : 'dashboard');
  const [studies, setStudies] = useState<RCMStudy[]>([]);
  const [selectedStudy, setSelectedStudy] = useState<RCMStudy | null>(null);
  const [functions, setFunctions] = useState<RCMFunction[]>([]);
  const [failureModes, setFailureModes] = useState<RCMFailureMode[]>([]);
  const [decisions, setDecisions] = useState<RCMDecision[]>([]);
  const [taskSummaries, setTaskSummaries] = useState<RCMTaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewStudy, setShowNewStudy] = useState(false);
  const [newStudyForm, setNewStudyForm] = useState<{
    title: string;
    asset_id: string;
    operating_context: string;
    study_type: 'classical' | 'streamlined' | 'back_to_basics';
  }>({
    title: '',
    asset_id: '',
    operating_context: '',
    study_type: 'classical',
  });
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit / Delete state
  const [editingStudy, setEditingStudy] = useState<RCMStudy | null>(null);
  const [editStudyForm, setEditStudyForm] = useState<{ title: string; asset_id: string; operating_context: string; study_type: string; status: string; facilitator: string; notes: string }>({ title: '', asset_id: '', operating_context: '', study_type: 'classical', status: 'draft', facilitator: '', notes: '' });
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'study' | 'function' | 'failure_mode'; id: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Collaboration state
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [studyCollaborators, setStudyCollaborators] = useState<StudyCollaborator[]>([]);

  // Measured life data — latest saved Weibull fit for the study's asset, so the
  // Decision Wizard suggests intervals from evidence, not guesswork.
  const [lifeEvidence, setLifeEvidence] = useState<RCMLifeEvidence | null>(null);

  // ── Decision Map (memoized) ────────────────────────────
  const decisionMap = useMemo(() => new Map(decisions.map(d => [d.failure_mode_id, d])), [decisions]);

  // ── Tab Progress (memoized) ────────────────────────────
  const tabProgress = useMemo(() => {
    const fnsCount = functions.length;
    const fmsCount = failureModes.length;
    const hasDecisions = Array.from(decisionMap.values());
    const decidedCount = hasDecisions.filter(d => !!d.consequence_code).length;
    const implementedCount = hasDecisions.filter(d => !!d.recommended_strategy_code).length;

    return {
      functions: {
        text: fnsCount > 0 ? `${fnsCount} Fns` : '0',
        complete: fnsCount > 0,
      },
      decisions: {
        text: fmsCount > 0 ? `${decidedCount}/${fmsCount}` : '0',
        complete: fmsCount > 0 && decidedCount === fmsCount,
      },
      tasks: {
        text: fmsCount > 0 ? `${implementedCount}/${fmsCount}` : '0',
        complete: fmsCount > 0 && implementedCount === fmsCount,
      },
    };
  }, [functions, failureModes, decisionMap]);

  // ── Load Data ──────────────────────────────────────────
  const loadStudies = useCallback(async () => {
    setLoading(true);
    const data = await rcmService.getStudies();
    setStudies(data);
    setLoading(false);
  }, []);

  const loadStudyDetail = useCallback(async (id: string) => {
    const study = await rcmService.getStudy(id);
    if (!study) return;
    setSelectedStudy(study);
    setStudyCollaborators((study as any).collaborators || []);
    const fns = await rcmService.getFunctions(id);
    setFunctions(fns);
    const fms = await rcmService.getFailureModesByStudy(id);
    setFailureModes(fms);
    const decs = await rcmService.getDecisions(id);
    setDecisions(decs);
    const tasks = await rcmService.getTaskSummaries(id);
    setTaskSummaries(tasks);

    // Pull the asset's latest saved Weibull fit from Reliability Modelling.
    setLifeEvidence(null);
    if (study.asset_id) {
      const fits = await analyzeService.getReliabilityAnalyses(study.asset_id, 'weibull');
      const latest = fits.find(f => f.results?.beta && f.results?.eta);
      if (latest) {
        const beta = Number(latest.results.beta);
        const eta = Number(latest.results.eta);
        const b10 = latest.results.b10 != null
          ? Math.round(Number(latest.results.b10))
          : Math.round(eta * Math.pow(-Math.log(0.9), 1 / beta));
        setLifeEvidence({
          beta, eta, b10,
          interval: Math.round(eta * (beta > 3 ? 0.7 : beta > 2 ? 0.75 : 0.8)),
          r2: latest.results.r2 != null ? Number(latest.results.r2) : undefined,
          source: latest.title,
          date: latest.updated_at,
        });
      }
    }
  }, []);

  useEffect(() => { loadStudies(); }, [loadStudies]);
  useEffect(() => { if (studyId) loadStudyDetail(studyId); }, [studyId, loadStudyDetail]);

  // Apply a Metrics → RCM drill-through seed once: open New Study pre-filled.
  useEffect(() => {
    if (rcmSeedAppliedRef.current || !rcmSeed?.asset?.id) return;
    rcmSeedAppliedRef.current = true;
    const a = rcmSeed.asset;
    const label = a.name || a.tag || 'Asset';
    const w = rcmSeed.weibull;
    const weibullContext = w
      ? `Weibull evidence (Reliability Modelling): β=${w.beta} (${w.beta > 3 ? 'rapid wear-out' : w.beta > 1 ? 'wear-out' : w.beta < 1 ? 'infant mortality' : 'random'}), η=${Math.round(w.eta).toLocaleString()} h, B10=${w.b10.toLocaleString()} h. Suggested PM interval ≈ ${w.interval.toLocaleString()} h${w.r2 != null ? ` (fit R²=${w.r2.toFixed(2)})` : ''}.`
      : '';
    setActiveTab('dashboard');
    if (hasAssetAccess) setAssetInputMode('search');
    setNewStudyForm({ title: `RCM — ${label}`, asset_id: a.id, operating_context: weibullContext, study_type: 'classical' });
    setShowNewStudy(true);
    // Clear the seed from history so a refresh/back doesn't re-open the form.
    navigate('/rcm', { replace: true });
  }, [rcmSeed, hasAssetAccess, navigate]);

  // ── Toast ──────────────────────────────────────────────
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Debounced Save ─────────────────────────────────────
  const debouncedSave = useCallback((key: string, fn: () => Promise<any>, delay = 800) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => { await fn(); }, delay);
  }, []);

  // ── Handlers ───────────────────────────────────────────
  const handleCreateStudy = async () => {
    setSaving(true);
    const study = await rcmService.createStudy({
      title: newStudyForm.title,
      asset_id: newStudyForm.asset_id || null,
      operating_context: newStudyForm.operating_context || null,
      study_type: newStudyForm.study_type,
    });
    setSaving(false);
    if (study) {
      setShowNewStudy(false);
      setNewStudyForm({ title: '', asset_id: '', operating_context: '', study_type: 'classical' });
      showToast('RCM Study created successfully');
      await loadStudies();
      navigate(`/rcm/${study.id}`);
    } else {
      showToast('Failed to create study', 'error');
    }
  };

  // Collaboration handlers
  const handleAddCollaborator = async (collab: StudyCollaborator) => {
    const updated = [...studyCollaborators, collab];
    setStudyCollaborators(updated);
    if (selectedStudy) await rcmService.updateStudy(selectedStudy.id, { collaborators: updated } as any);
  };
  const handleRemoveCollaborator = async (id: string) => {
    const updated = studyCollaborators.filter(c => c.id !== id);
    setStudyCollaborators(updated);
    if (selectedStudy) await rcmService.updateStudy(selectedStudy.id, { collaborators: updated } as any);
  };
  const handleUpdateCollabRole = async (id: string, role: StudyCollaborator['role']) => {
    const updated = studyCollaborators.map(c => c.id === id ? { ...c, role } : c);
    setStudyCollaborators(updated);
    if (selectedStudy) await rcmService.updateStudy(selectedStudy.id, { collaborators: updated } as any);
  };

  const handleSelectStudy = (study: RCMStudy) => { navigate(`/rcm/${study.id}`); setActiveTab('functions'); };
  const handleBackToDashboard = () => { navigate('/rcm'); setSelectedStudy(null); setActiveTab('dashboard'); loadStudies(); };

  const handleInlineStudyUpdate = (field: string, value: any) => {
    if (!selectedStudy) return;
    setSelectedStudy(prev => prev ? { ...prev, [field]: value } : null);
    debouncedSave(`study-${field}`, () => rcmService.updateStudy(selectedStudy.id, { [field]: value }));
  };

  // Edit Study
  const handleOpenEditStudy = (study: RCMStudy, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingStudy(study);
    setEditStudyForm({
      title: study.title, asset_id: study.asset_id || '', operating_context: study.operating_context || '',
      study_type: study.study_type, status: study.status, facilitator: study.facilitator || '', notes: study.notes || '',
    });

    // Set appropriate input mode based on whether asset ID matches a registered asset
    if (permissions?.assets?.view && study.asset_id && assetOptions.some(a => a.id === study.asset_id)) {
      setEditAssetInputMode('search');
    } else {
      setEditAssetInputMode('manual');
    }
  };

  const handleSaveEditStudy = async () => {
    if (!editingStudy) return;
    setSaving(true);
    const updated = await rcmService.updateStudy(editingStudy.id, {
      title: editStudyForm.title, asset_id: editStudyForm.asset_id || null,
      operating_context: editStudyForm.operating_context || null, study_type: editStudyForm.study_type as any,
      status: editStudyForm.status as any, facilitator: editStudyForm.facilitator || null, notes: editStudyForm.notes || null,
    });
    setSaving(false);
    if (updated) {
      setEditingStudy(null); showToast('Study updated successfully');
      await loadStudies();
      if (selectedStudy?.id === updated.id) setSelectedStudy(updated);
    } else { showToast('Failed to update study', 'error'); }
  };

  // Delete
  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setSaving(true);
    let success = false;
    switch (confirmDelete.type) {
      case 'study':
        success = await rcmService.deleteStudy(confirmDelete.id);
        if (success) { showToast('Study deleted'); if (selectedStudy?.id === confirmDelete.id) handleBackToDashboard(); else await loadStudies(); }
        break;
      case 'function':
        success = await rcmService.deleteFunction(confirmDelete.id);
        if (success) { showToast('Function deleted'); setFunctions(prev => prev.filter(f => f.id !== confirmDelete.id)); setFailureModes(prev => prev.filter(fm => fm.function_id !== confirmDelete.id)); }
        break;
      case 'failure_mode':
        success = await rcmService.deleteFailureMode(confirmDelete.id);
        if (success) { showToast('Failure mode deleted'); setFailureModes(prev => prev.filter(fm => fm.id !== confirmDelete.id)); setDecisions(prev => prev.filter(d => d.failure_mode_id !== confirmDelete.id)); }
        break;
    }
    if (!success) showToast(`Failed to delete ${confirmDelete.type.replace('_', ' ')}`, 'error');
    setSaving(false); setConfirmDelete(null);
  };

  // Functions & Failure Modes CRUD
  const handleAddFunction = async () => {
    if (!selectedStudy) return;
    const fn = await rcmService.createFunction({
      study_id: selectedStudy.id, function_number: `F${functions.length + 1}`,
      function_description: '', function_type: 'primary', sort_order: functions.length + 1,
    });
    if (fn) setFunctions(prev => [...prev, fn]);
  };

  const handleAddFailureMode = async (functionId: string) => {
    const count = failureModes.filter(fm => fm.function_id === functionId).length;
    const fm = await rcmService.createFailureMode({
      function_id: functionId, failure_mode_description: '', data_source: 'manual', sort_order: count + 1,
    });
    if (fm) setFailureModes(prev => [...prev, fm]);
  };

  const handleUpdateFunction = async (id: string, updates: Partial<RCMFunction>) => {
    const updated = await rcmService.updateFunction(id, updates);
    if (updated) setFunctions(prev => prev.map(f => f.id === id ? { ...f, ...updated } : f));
  };

  const handleUpdateFailureMode = async (id: string, updates: Partial<RCMFailureMode>) => {
    // Auto-compute RPN when severity or occurrence changes
    if ('severity' in updates || 'occurrence' in updates) {
      const currentFM = failureModes.find(fm => fm.id === id);
      if (currentFM) {
        const sev = ('severity' in updates ? updates.severity : currentFM.severity) || 0;
        const occ = ('occurrence' in updates ? updates.occurrence : currentFM.occurrence) || 0;
        updates.rpn = sev * occ;
      }
    }
    const updated = await rcmService.updateFailureMode(id, updates);
    if (updated) setFailureModes(prev => prev.map(fm => fm.id === id ? { ...fm, ...updated } : fm));
  };

  const handleUpdateDecision = async (fmId: string, updates: Partial<RCMDecision>) => {
    const existing = decisions.find(d => d.failure_mode_id === fmId);
    if (existing) {
      // Optimistic update for instant UI response
      setDecisions(prev => prev.map(d => d.failure_mode_id === fmId ? { ...d, ...updates } : d));
      const updated = await rcmService.updateDecision(existing.id, updates);
      if (updated) {
        setDecisions(prev => prev.map(d => d.failure_mode_id === fmId ? { ...d, ...updated } : d));
      } else {
        // Revert on failure
        setDecisions(prev => prev.map(d => d.failure_mode_id === fmId ? existing : d));
        showToast('Failed to update decision', 'error');
      }
    } else {
      // New decision — INSERT with minimal required fields + the user's changes
      const payload: Record<string, any> = {
        failure_mode_id: fmId,
        is_hidden_failure: false,
        spares_requirements: [],
        ...updates,
      };
      // Optimistic: create a temporary decision in state so UI responds immediately
      const tempDecision: RCMDecision = {
        id: `temp-${fmId}`,
        failure_mode_id: fmId,
        is_hidden_failure: false,
        consequence_code: null,
        consequence_description: null,
        on_condition_task: null,
        on_condition_interval: null,
        on_condition_applicable: null,
        on_condition_technology: null,
        scheduled_restoration_task: null,
        restoration_interval: null,
        restoration_applicable: null,
        scheduled_discard_task: null,
        discard_interval: null,
        discard_applicable: null,
        failure_finding_task: null,
        failure_finding_interval: null,
        failure_finding_applicable: null,
        recommended_strategy_code: null,
        task_description: null,
        task_interval: null,
        task_type_code: null,
        task_owner_craft: null,
        justification: null,
        ai_recommendation: null,
        recurring_work_id: null,
        spares_requirements: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...updates,
      };
      setDecisions(prev => [...prev, tempDecision]);

      const created = await rcmService.createDecision(payload as Partial<RCMDecision>);
      if (created) {
        // Replace temp with real DB record
        setDecisions(prev => prev.map(d => d.failure_mode_id === fmId ? created : d));
      } else {
        // Remove temp on failure
        setDecisions(prev => prev.filter(d => d.id !== `temp-${fmId}`));
        showToast('Failed to create decision record', 'error');
      }
    }
  };

  // AI handlers
  const handleAISuggest = async () => {
    if (!selectedStudy) return;
    setAiLoading('suggest');
    const result = await rcmService.aiSuggestFunctions(selectedStudy);
    if (result?.functions) {
      for (const fn of result.functions) {
        const created = await rcmService.createFunction({
          study_id: selectedStudy.id, function_number: fn.number, function_description: fn.description,
          performance_standard: fn.performance_standard, function_type: fn.type as any || 'primary',
          functional_failure: fn.functional_failure, sort_order: functions.length + 1,
        });
        if (created) {
          for (const fm of fn.failure_modes || []) {
            await rcmService.createFailureMode({
              function_id: created.id, failure_mode_description: fm.description, failure_cause_description: fm.cause,
              failure_effect_local: fm.effect_local, failure_effect_system: fm.effect_system,
              failure_effect_plant: fm.effect_plant, data_source: 'ai_generated', sort_order: 0,
            });
          }
        }
      }
      await loadStudyDetail(selectedStudy.id);
    }
    setAiLoading(null);
  };

  const handleAIRecommend = async (fm: RCMFailureMode) => {
    const decision = decisions.find(d => d.failure_mode_id === fm.id);
    setAiLoading(`recommend-${fm.id}`);
    const rec = await rcmService.aiRecommendStrategy(fm, decision?.consequence_code || undefined);
    if (rec) {
      await handleUpdateDecision(fm.id, {
        ai_recommendation: rec, recommended_strategy_code: rec.strategy,
        task_description: `AI: ${rec.reasoning?.substring(0, 200)}`,
        task_interval: rec.suggested_interval || '', justification: rec.reasoning,
      });
    }
    setAiLoading(null);
  };

  const handleAIOptimize = async () => {
    if (!selectedStudy) return;
    setAiLoading('optimize');
    const report = await rcmService.aiOptimizeStudy(selectedStudy.id);
    setAiReport(report);
    setAiLoading(null);
  };

  const handleGeneratePM = async () => {
    if (!selectedStudy) return;
    if (!selectedStudy.asset_id) {
      showToast('Link an asset to this study first (Edit Study → Asset ID)', 'error');
      return;
    }
    setAiLoading('pm');
    const count = await rcmService.generatePMSchedule(selectedStudy.id);
    setAiLoading(null);
    if (count > 0) {
      showToast(`${count} PM task${count !== 1 ? 's' : ''} created in Work Management`);
      await loadStudyDetail(selectedStudy.id);
    } else {
      showToast('No new PM tasks — decisions need a strategy first, or PMs already exist', 'error');
    }
  };

  // Sticky-bar action: always lands on the Functions tab, then adds
  const handleStickyAddFunction = () => {
    setActiveTab('functions');
    handleAddFunction();
  };



  // ── Render ─────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* ═══ Page Header ═══ */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div className="flex items-center gap-3">
          {selectedStudy && (
            <button onClick={handleBackToDashboard} className="p-2 text-slate-400 hover:text-accent-cyan hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-800 font-sans tracking-tight">
              {selectedStudy ? selectedStudy.title : 'Reliability Centered Maintenance'}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {selectedStudy
                ? `SAE JA1011 • ${selectedStudy.study_type.replace(/_/g, ' ')} • ${selectedStudy.status.replace('_', ' ')}`
                : 'SAE JA1011/JA1012 • Optimal maintenance strategy per asset function'
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          {!selectedStudy && (
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-none min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text" placeholder="Search studies..." value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 focus:border-accent-cyan placeholder:text-slate-400 w-full md:w-64"
                />
              </div>
              <button onClick={() => setShowNewStudy(true)} className="flex items-center gap-2 px-3 md:px-4 py-2.5 bg-accent-cyan hover:bg-primary-400 text-brand-900 font-semibold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] shrink-0">
                <Plus size={16} /> <span className="hidden sm:inline">New RCM Study</span><span className="sm:hidden">New Study</span>
              </button>
            </div>
          )}
          {selectedStudy && (
            <>
              <span className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-lg border ${CRIT_COLORS[selectedStudy.criticality_rank || 'C']}`}>
                Criticality {selectedStudy.criticality_rank || '—'}
              </span>
              <select value={selectedStudy.status} onChange={e => handleInlineStudyUpdate('status', e.target.value)}
                className="text-xs font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-600 focus:outline-none focus:border-accent-cyan appearance-none cursor-pointer">
                <option value="draft">Draft</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="approved">Approved</option>
                <option value="closed">Closed</option>
              </select>
              <button onClick={() => handleOpenEditStudy(selectedStudy)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit study">
                <Edit3 size={16} />
              </button>
              <button onClick={() => setConfirmDelete({ type: 'study', id: selectedStudy.id, name: selectedStudy.title })} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete study">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══ Frozen Action Bar — pinned to the top while the study scrolls ═══ */}
      {selectedStudy && (
        <div className="sticky -top-4 md:-top-6 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200/70 flex items-center gap-2">
          <button
            onClick={handleStickyAddFunction}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:border-accent-cyan hover:text-accent-cyan transition-colors shadow-sm shrink-0"
          >
            <Plus size={14} /> Add Function
          </button>
          <button
            onClick={() => setShowTeamPanel(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-primary-500 to-primary-500 hover:from-primary-600 hover:to-primary-600 text-white font-semibold rounded-lg text-xs transition-all shadow-md shadow-primary-500/25 shrink-0"
            title="Invite people, teams, or departments"
          >
            {studyCollaborators.length === 0 && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
              </span>
            )}
            <Users size={14} />
            <span>{studyCollaborators.length > 0 ? `Team (${studyCollaborators.length})` : 'Invite Team'}</span>
          </button>
          {studyCollaborators.length > 0 && <AvatarStack collaborators={studyCollaborators} max={3} size="sm" />}
          <span className="ml-auto text-[10px] text-slate-400 font-medium truncate hidden sm:block">
            {selectedStudy.title}
          </span>
        </div>
      )}

      {/* ═══ Tab Navigation (when study selected) ═══ */}
      {selectedStudy && (
        <ScrollTabStrip activeId={activeTab} className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {RCM_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const progress = tab.id !== 'dashboard' ? tabProgress[tab.id as 'functions' | 'decisions' | 'tasks'] : null;

            return (
              <button
                key={tab.id}
                data-active={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${isActive
                  ? 'bg-accent-cyan text-brand-900 shadow-sm shadow-primary-500/20'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {progress && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-all ${
                    progress.complete
                      ? isActive
                        ? 'bg-brand-900/10 text-brand-900'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : isActive
                        ? 'bg-brand-900/10 text-brand-900'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {progress.text}
                  </span>
                )}
                <span className={`hidden lg:inline text-[10px] font-normal ${isActive ? 'text-brand-900/60' : 'text-slate-400'}`}>
                  — {tab.desc}
                </span>
              </button>
            );
          })}
        </ScrollTabStrip>
      )}

      {/* ═══ Tab Content ═══ */}

      {/* Study Overview — the Dashboard tab inside a selected study */}
      {activeTab === 'dashboard' && selectedStudy && (
        <RCMStudyOverview
          study={selectedStudy}
          functions={functions}
          failureModes={failureModes}
          decisions={decisionMap}
          taskSummaries={taskSummaries}
          collaborators={studyCollaborators}
          onNavigate={setActiveTab}
          onInviteTeam={() => setShowTeamPanel(true)}
          onEditStudy={() => handleOpenEditStudy(selectedStudy)}
        />
      )}

      {/* Dashboard */}
      {(activeTab === 'dashboard' && !selectedStudy) && (
        <RCMStudyDashboard
          studies={studies}
          loading={loading}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectStudy={handleSelectStudy}
          onCreateStudy={() => setShowNewStudy(true)}
          onEditStudy={handleOpenEditStudy}
          onDeleteStudy={(study) => setConfirmDelete({ type: 'study', id: study.id, name: study.title })}
        />
      )}

      {/* Functions & Failures (Q1-Q5) */}
      {activeTab === 'functions' && selectedStudy && (
        <RCMFunctionPanel
          study={selectedStudy}
          functions={functions}
          failureModes={failureModes}
          decisions={decisionMap}
          aiLoading={aiLoading}
          onAddFunction={handleAddFunction}
          onUpdateFunction={handleUpdateFunction}
          onDeleteFunction={(id, name) => setConfirmDelete({ type: 'function', id, name })}
          onAddFailureMode={handleAddFailureMode}
          onUpdateFailureMode={handleUpdateFailureMode}
          onDeleteFailureMode={(id, name) => setConfirmDelete({ type: 'failure_mode', id, name })}
          onAISuggest={handleAISuggest}
          onUpdateDecision={handleUpdateDecision}
        />
      )}

      {/* Decision Logic (Q6-Q7) */}
      {activeTab === 'decisions' && selectedStudy && (
        <RCMDecisionWizard
          study={selectedStudy}
          failureModes={failureModes}
          functions={functions}
          decisions={decisionMap}
          aiLoading={aiLoading}
          lifeEvidence={lifeEvidence}
          onUpdateDecision={handleUpdateDecision}
          onAIRecommend={handleAIRecommend}
        />
      )}

      {/* Task Output */}
      {activeTab === 'tasks' && selectedStudy && (
        <RCMTaskMatrix
          study={selectedStudy}
          taskSummaries={taskSummaries}
          decisions={decisionMap}
          aiLoading={aiLoading}
          aiReport={aiReport}
          onGeneratePM={handleGeneratePM}
          onAIOptimize={handleAIOptimize}
          onCloseReport={() => setAiReport(null)}
        />
      )}

      {/* Living-RCM Evidence — the study checked against the asset's data */}
      {activeTab === 'evidence' && selectedStudy && (
        <RCMEvidencePanel
          study={selectedStudy}
          failureModes={failureModes}
          decisions={decisionMap}
        />
      )}
      {activeTab === 'evidence' && !selectedStudy && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">Select a study on the Dashboard first.</div>
      )}

      {/* ═══ New Study Modal ═══ */}
      {showNewStudy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowNewStudy(false)}>
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><Shield size={20} /></div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">New RCM Study</h2>
                  <p className="text-xs text-slate-500 mt-0.5">SAE JA1011 · Reliability Centered Maintenance</p>
                </div>
              </div>
              <button onClick={() => setShowNewStudy(false)} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Study Title</label>
                <input type="text" value={newStudyForm.title} onChange={e => setNewStudyForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. K-101A Centrifugal Compressor RCM Study"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" autoFocus />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Asset ID (optional)</label>
                  {hasAssetAccess && (
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setAssetInputMode('search');
                          setNewStudyForm(f => ({ ...f, asset_id: '' }));
                        }}
                        className={`px-2 py-0.5 rounded transition-colors ${assetInputMode === 'search' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Search Register
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssetInputMode('manual');
                          setNewStudyForm(f => ({ ...f, asset_id: '' }));
                        }}
                        className={`px-2 py-0.5 rounded transition-colors ${assetInputMode === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Manual Tag
                      </button>
                    </div>
                  )}
                </div>
                {assetInputMode === 'search' && hasAssetAccess ? (
                  <div className="relative">
                    <select
                      value={newStudyForm.asset_id}
                      onChange={e => {
                        const selectedId = e.target.value;
                        const asset = assetOptions.find(a => a.id === selectedId);
                        setNewStudyForm(f => ({
                          ...f,
                          asset_id: selectedId,
                          title: f.title ? f.title : asset ? `${asset.tag} — ${asset.name} RCM Study` : ''
                        }));
                      }}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan appearance-none cursor-pointer"
                    >
                      <option value="">-- Select Asset from Register --</option>
                      {assetOptions.map(asset => (
                        <option key={asset.id} value={asset.id}>
                          {asset.tag} — {asset.name} ({asset.site})
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                  </div>
                ) : (
                  <input type="text" value={newStudyForm.asset_id} onChange={e => setNewStudyForm(f => ({ ...f, asset_id: e.target.value }))}
                    placeholder="e.g. Equipment UUID or tag"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" />
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Operating Context</label>
                <textarea value={newStudyForm.operating_context} onChange={e => setNewStudyForm(f => ({ ...f, operating_context: e.target.value }))}
                  placeholder="Describe the duty cycle, environment, load profile, etc." rows={3}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Study Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(['classical', 'streamlined', 'back_to_basics'] as const).map(type => (
                    <button key={type} onClick={() => setNewStudyForm(f => ({ ...f, study_type: type }))}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all capitalize ${newStudyForm.study_type === type
                        ? 'bg-accent-cyan text-brand-900 border-accent-cyan shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {type.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-end gap-3">
              <button onClick={() => setShowNewStudy(false)} className="px-4 py-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleCreateStudy} disabled={!newStudyForm.title}
                className="px-6 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-40 text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] flex items-center gap-2">
                <Shield size={16} /> Create Study
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Edit Study Modal ═══ */}
      {editingStudy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditingStudy(null)}>
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Edit3 size={20} /></div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Edit Study</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Modify RCM study properties</p>
                </div>
              </div>
              <button onClick={() => setEditingStudy(null)} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Study Title</label>
                <input type="text" value={editStudyForm.title} onChange={e => setEditStudyForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Status</label>
                  <select value={editStudyForm.status} onChange={e => setEditStudyForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan appearance-none cursor-pointer">
                    <option value="draft">Draft</option><option value="in_progress">In Progress</option>
                    <option value="review">Review</option><option value="approved">Approved</option><option value="closed">Closed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Facilitator</label>
                  <input type="text" value={editStudyForm.facilitator} onChange={e => setEditStudyForm(f => ({ ...f, facilitator: e.target.value }))}
                    placeholder="Lead analyst" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Asset ID</label>
                  {hasAssetAccess && (
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setEditAssetInputMode('search');
                          setEditStudyForm(f => ({ ...f, asset_id: '' }));
                        }}
                        className={`px-2 py-0.5 rounded transition-colors ${editAssetInputMode === 'search' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Search Register
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditAssetInputMode('manual');
                          setEditStudyForm(f => ({ ...f, asset_id: '' }));
                        }}
                        className={`px-2 py-0.5 rounded transition-colors ${editAssetInputMode === 'manual' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Manual Tag
                      </button>
                    </div>
                  )}
                </div>
                {editAssetInputMode === 'search' && hasAssetAccess ? (
                  <div className="relative">
                    <select
                      value={editStudyForm.asset_id}
                      onChange={e => {
                        const selectedId = e.target.value;
                        const asset = assetOptions.find(a => a.id === selectedId);
                        setEditStudyForm(f => ({
                          ...f,
                          asset_id: selectedId,
                          title: f.title ? f.title : asset ? `${asset.tag} — ${asset.name} RCM Study` : ''
                        }));
                      }}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan appearance-none cursor-pointer"
                    >
                      <option value="">-- Select Asset from Register --</option>
                      {assetOptions.map(asset => (
                        <option key={asset.id} value={asset.id}>
                          {asset.tag} — {asset.name} ({asset.site})
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                  </div>
                ) : (
                  <input type="text" value={editStudyForm.asset_id} onChange={e => setEditStudyForm(f => ({ ...f, asset_id: e.target.value }))}
                    placeholder="Equipment UUID or tag" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400" />
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Operating Context</label>
                <textarea value={editStudyForm.operating_context} onChange={e => setEditStudyForm(f => ({ ...f, operating_context: e.target.value }))}
                  placeholder="Describe the duty cycle, environment, load profile..." rows={3}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Study Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(['classical', 'streamlined', 'back_to_basics'] as const).map(type => (
                    <button key={type} onClick={() => setEditStudyForm(f => ({ ...f, study_type: type }))}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all capitalize ${editStudyForm.study_type === type
                        ? 'bg-accent-cyan text-brand-900 border-accent-cyan shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {type.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Notes</label>
                <textarea value={editStudyForm.notes} onChange={e => setEditStudyForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Additional notes..." rows={2}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-accent-cyan placeholder:text-slate-400 resize-none" />
              </div>
            </div>
            <div className="p-6 pt-0 flex justify-end gap-3">
              <button onClick={() => setEditingStudy(null)} className="px-4 py-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleSaveEditStudy} disabled={!editStudyForm.title || saving}
                className="px-6 py-2 bg-accent-cyan hover:bg-primary-400 disabled:opacity-40 text-brand-900 font-bold rounded-lg text-sm transition-colors shadow-[0_0_15px_rgba(6,182,212,0.2)] flex items-center gap-2">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />} Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Confirm Delete Dialog ═══ */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="mx-auto w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mb-4">
                <Trash2 size={24} className="text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Delete {confirmDelete.type.replace('_', ' ')}?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Are you sure you want to delete <strong className="text-slate-700">"{confirmDelete.name}"</strong>?
                {confirmDelete.type === 'study' && <span className="block mt-1 text-red-500 text-xs font-medium">This will permanently delete all functions, failure modes, and decisions.</span>}
                {confirmDelete.type === 'function' && <span className="block mt-1 text-red-500 text-xs font-medium">All associated failure modes and decisions will also be deleted.</span>}
              </p>
            </div>
            <div className="p-6 pt-0 flex justify-center gap-3">
              <button onClick={() => setConfirmDelete(null)} className="px-5 py-2 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={handleConfirmDelete} disabled={saving}
                className="px-5 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-colors flex items-center gap-2">
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Toast ═══ */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-lg border animate-in slide-in-from-bottom-5 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-red-500" />}
          <span className="text-sm font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 p-0.5 hover:bg-black/5 rounded"><X size={14} /></button>
        </div>
      )}

      {/* ═══ Team Panel ═══ */}
      {showTeamPanel && (
        <TeamPanel
          collaborators={studyCollaborators}
          onAdd={handleAddCollaborator}
          onRemove={handleRemoveCollaborator}
          onUpdateRole={handleUpdateCollabRole}
          onClose={() => setShowTeamPanel(false)}
          accentColor="cyan"
        />
      )}
    </div>
  );
};
