/**
 * Reliability Modelling Division — Quantitative: "How reliable is it?"
 *
 * Consolidates all engineering calculators + system modelling tools:
 *   - MTBF / MTTR (with confidence intervals)
 *   - Operational Availability (Ao)
 *   - Weibull Life Analysis
 *   - Spares Demand (Poisson)
 *   - Maintainability (Lognormal)
 *   - RBD / P&ID Block Diagrams
 *
 * Features: Asset-WO data integration, save/edit/delete for all calculators.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Activity, TrendingUp, Package, Cpu, Dices,
    Save, FolderOpen, Trash2, Edit3, Clock, ChevronDown, ChevronUp, Info,
    AlertCircle, Check, X, ArrowRight, Plus,
} from 'lucide-react';

// Individual calculator tabs exported from the Toolkit
import {
    RAMDashboardTab,
    WeibullTab,
    SparesTab,
} from '../../eam/pages/ReliabilityToolkit';

// RBD / P&ID modeling
import ReliabilityModelingTab, { type PidEntry } from './ReliabilityModelingTab';

// Monte Carlo
import { MonteCarloSimTab } from '../../eam/components/MonteCarloSimTab';

// Service
import analyzeService from '../../eam/services/AnalyzeService';
import type { ReliabilityAnalysis, ReliabilityAnalysisType, ReliabilityStudy } from '../../eam/services/AnalyzeService';
import { useAuth } from '../../eam/contexts/AuthContext';
import { useReliabilityPerms } from '../../eam/hooks/useReliabilityPerms';
import { StudyRecordsPanel } from './ReliabilityStudyRecords';
import ReliabilityStartHere from './ReliabilityStartHere';
import ReliabilityStudyWorkspace from './ReliabilityStudyWorkspace';
import NewStudyModal from './NewStudyModal';
import { objectiveDef, type StudyObjective } from './studyObjectives';
import type { ReliabilityStudyOutcome } from '../../eam/services/AnalyzeService';

type CalcTab = 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';

// A tool is chosen by the DECISION a user needs to make, not by the method's
// name — someone who has never heard of a Weibull still knows they need to
// decide when to change a part out. So each card leads with the question,
// names the method as a small chip, states what you walk away with (`outcome`)
// and what the data has to carry for the answer to be worth anything (`needs`).
const CALC_TABS: {
    id: CalcTab;
    label: string;                 // the method — used by the in-tool switch bar
    icon: React.ReactNode;
    question: string;              // the decision, in the user's words
    outcome: string;               // what leaves the tool as work
    needs: string;                 // the data precondition, stated up front
    desc: string;
    analysisType?: ReliabilityAnalysisType;
}[] = [
    {
        id: 'weibull', label: 'Weibull', icon: <TrendingUp size={14} />,
        question: 'When should we change this out — before it fails?',
        outcome: 'A replacement age at the risk you accept, and a PM program in one click',
        needs: '5+ recorded failures on the asset (or pool a class)',
        desc: 'Life data analysis — B-life values, failure pattern characterization',
        analysisType: 'weibull',
    },
    {
        id: 'ram', label: 'RAM', icon: <Activity size={14} />,
        question: 'How often does it fail, and how much uptime does that cost?',
        outcome: 'MTBF, MTTR and availability with confidence bounds — the baseline you improve against',
        needs: '2+ corrective work orders, downtime hours recorded',
        desc: 'Reliability, Availability & Maintainability — unified MTBF/MTTR/Ao analysis',
        analysisType: 'mtbf',
    },
    {
        id: 'montecarlo', label: 'Monte Carlo', icon: <Dices size={14} />,
        question: 'Is this PM interval worth doing?',
        outcome: 'Cost and downtime at P10/P50/P90 for each interval — planned change-out vs run-to-failure',
        needs: 'A Weibull fit (β, η) — run the life fit first',
        desc: 'Probabilistic lifecycle simulation — Weibull failures, PM optimization, P10/P50/P90 forecasting',
        analysisType: 'montecarlo',
    },
    {
        id: 'spares', label: 'Spares', icon: <Package size={14} />,
        question: 'How many spares should we hold on the shelf?',
        outcome: 'A min stock level that survives the resupply window at your service level',
        needs: 'MTBF, how many units you run, and the lead time',
        desc: 'Poisson-based spare parts stocking recommendation',
        analysisType: 'spares',
    },
    {
        id: 'rbd', label: 'Block Diagram', icon: <Cpu size={14} />,
        question: 'Which single item takes the whole system down?',
        outcome: 'System availability and a weakest-link ranking to spend on',
        needs: 'Your asset hierarchy, or a P&ID to model from',
        desc: 'Reliability Block Diagrams & P&ID system modelling',
    },
];

// ─── Save Analysis Modal ──────────────────────────────────────
function SaveAnalysisModal({ isOpen, onClose, onSave, analysisType, editingId, initialTitle, initialNotes, showStudyPicker, studies, defaultStudyName }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (title: string, notes: string, study?: { studyId: string | null; newName?: string }) => void;
    analysisType: ReliabilityAnalysisType;
    editingId: string | null;
    initialTitle?: string;
    initialNotes?: string;
    showStudyPicker?: boolean;                       // true only when starting a new lineage
    studies?: ReliabilityStudy[];                    // existing studies (already asset-scoped by caller)
    defaultStudyName?: string;                       // suggested name when creating a new study
}) {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');
    // Study selection: a study id, '__none__' (ungrouped), or '__new__' (create)
    const [studySel, setStudySel] = useState<string>('__none__');
    const [newStudyName, setNewStudyName] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        if (editingId) {
            // Editing an existing version — prefill its current title/notes.
            setTitle(initialTitle || '');
            setNotes(initialNotes || '');
        } else {
            const typeLabel = analysisType.toUpperCase();
            setTitle(`${typeLabel} Analysis — ${new Date().toLocaleDateString()}`);
            setNotes('');
        }
        // Default to the most recent matching study if one exists, else ungrouped.
        setStudySel(studies && studies.length > 0 ? studies[0].id : '__none__');
        setNewStudyName(defaultStudyName || '');
    }, [isOpen, analysisType, editingId, initialTitle, initialNotes, studies, defaultStudyName]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        let study: { studyId: string | null; newName?: string } | undefined;
        if (showStudyPicker) {
            if (studySel === '__new__') study = { studyId: null, newName: newStudyName };
            else if (studySel === '__none__') study = { studyId: null };
            else study = { studyId: studySel };
        }
        onSave(title, notes, study);
        onClose();
    };

    const confirmDisabled = !title.trim() || (showStudyPicker && studySel === '__new__' && !newStudyName.trim());

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800">
                        {editingId ? 'Update study details' : 'Save study'}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                </div>
                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                            placeholder="e.g. GT-301 MTBF Analysis Q1 2026" />
                    </div>

                    {/* Study assignment — only when starting a new analysis lineage */}
                    {showStudyPicker && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Study</label>
                            <select value={studySel} onChange={e => setStudySel(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500">
                                <option value="__none__">No study (ungrouped)</option>
                                {(studies || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                <option value="__new__">+ New study…</option>
                            </select>
                            {studySel === '__new__' && (
                                <input type="text" value={newStudyName} onChange={e => setNewStudyName(e.target.value)}
                                    className="mt-2 w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                    placeholder="New study name — e.g. GT-301 Reliability Review Q2 2026" />
                            )}
                            <p className="text-[11px] text-slate-400 mt-1">Group this analysis with others for the same asset (RBD, RAM, Weibull, Monte Carlo).</p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)}
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                            placeholder="Add context, assumptions, or remarks..." />
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleConfirm}
                        disabled={confirmDisabled}
                        className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-500 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50">
                        {editingId ? 'Update' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Delete Confirmation ──────────────────────────────────────
function DeleteConfirm({ isOpen, title, onConfirm, onCancel }: {
    isOpen: boolean; title: string; onConfirm: () => void; onCancel: () => void;
}) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-in zoom-in duration-200">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                        <AlertCircle size={20} className="text-red-600" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-800">Delete Analysis</h3>
                        <p className="text-xs text-slate-500">This action cannot be undone</p>
                    </div>
                </div>
                <p className="text-sm text-slate-600 mb-5">
                    Are you sure you want to delete <strong>"{title}"</strong>?
                </p>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={onConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg">Delete</button>
                </div>
            </div>
        </div>
    );
}

// ─── Saved Analyses Panel ─────────────────────────────────────
function SavedAnalysesPanel({ analyses, activeId, onLoad, onEdit, onDelete, loading }: {
    analyses: ReliabilityAnalysis[];
    activeId: string | null;
    onLoad: (a: ReliabilityAnalysis) => void;
    onEdit: (a: ReliabilityAnalysis) => void;
    onDelete: (a: ReliabilityAnalysis) => void;
    loading: boolean;
}) {
    const [expanded, setExpanded] = useState(false);

    if (analyses.length === 0 && !loading) return null;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <FolderOpen size={16} className="text-primary-500" />
                    Saved Analyses ({analyses.length})
                </div>
                {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {expanded && (
                <div className="border-t border-slate-100 divide-y divide-slate-50 max-h-64 overflow-y-auto">
                    {loading ? (
                        <div className="px-4 py-6 text-center text-xs text-slate-400 animate-pulse">Loading saved analyses...</div>
                    ) : analyses.map(a => (
                        <div key={a.id}
                            className={`flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${a.id === activeId ? 'bg-primary-50 border-l-2 border-primary-500' : ''}`}>
                            <div className="flex-1 min-w-0">
                                <p className={`font-medium truncate ${a.id === activeId ? 'text-primary-700' : 'text-slate-700'}`}>{a.title}</p>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                                    <span className="px-1.5 py-0.5 bg-slate-100 rounded font-medium uppercase">{a.analysis_type}</span>
                                    {a.asset_tag && <span>{a.asset_tag}</span>}
                                    <span title={`Created ${new Date(a.created_at).toLocaleString()}`}>
                                        <Clock size={9} className="inline" /> {new Date(a.created_at).toLocaleDateString()}
                                    </span>
                                    {a.updated_at !== a.created_at && (
                                        <span title={`Last updated ${new Date(a.updated_at).toLocaleString()}`}>
                                            · edited {new Date(a.updated_at).toLocaleDateString()}
                                        </span>
                                    )}
                                    {a.created_by && <span>· by {a.created_by}</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => onLoad(a)} title="Load"
                                    className={`p-1.5 rounded-lg transition-colors ${a.id === activeId ? 'text-primary-600 bg-primary-100' : 'text-slate-400 hover:text-primary-600 hover:bg-primary-50'}`}>
                                    <FolderOpen size={14} />
                                </button>
                                <button onClick={() => onEdit(a)} title="Edit"
                                    className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                                    <Edit3 size={14} />
                                </button>
                                <button onClick={() => onDelete(a)} title="Delete"
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN DIVISION
// ═══════════════════════════════════════════════════════════════
interface DivisionProps {
    onContextChange?: (context: {
        asset: { id: string; tag: string; name: string } | null;
        results: Record<string, any>;
        activeTab: CalcTab | null;
    }) => void;
    /** Drill-through seed (e.g. Metrics bad actor → Fit Weibull): opens a tab with an asset pre-selected. */
    seed?: { asset: { id: string; name: string; tag: string; criticality: string } | null; tab?: CalcTab } | null;
    /**
     * Full-page tool mode (URL-controlled by the page): null renders the
     * launcher overview (study records + tool cards); a tool id renders that
     * tool as its own page with a back link. Omit both props for the legacy
     * always-inline behavior.
     */
    tool?: CalcTab | null;
    onToolChange?: (t: CalcTab | null) => void;
    /** Open study (?study=<id>) — the launcher shows its workspace instead of the register. */
    studyId?: string | null;
    onStudyChange?: (id: string | null) => void;
    /** Deep link into Block Diagram's P&ID view (from Predict): the drawing to open, or a New drawing title. */
    pidEntry?: PidEntry | null;
}

export const ReliabilityModellingDivision: React.FC<DivisionProps> = ({ onContextChange, seed, tool, onToolChange, studyId, onStudyChange, pidEntry }) => {
    const { profile, user } = useAuth();
    // Human-readable author stamped on saved studies (falls back gracefully).
    const currentAuthor = profile?.username || profile?.fullName || user?.email || null;
    // Role state (audit M-5): the page offers only what 0358 will let through.
    const perms = useReliabilityPerms();

    // Controlled (URL) when onToolChange is provided; internal state otherwise.
    const [internalCalc, setInternalCalc] = useState<CalcTab | null>('ram');
    const controlled = onToolChange !== undefined;
    const activeCalc: CalcTab | null = controlled ? (tool ?? null) : internalCalc;
    const openTool = useCallback((t: CalcTab | null) => {
        if (controlled) onToolChange!(t);
        else setInternalCalc(t);
    }, [controlled, onToolChange]);

    // Apply a drill-through seed once: open the requested tab (default Weibull).
    // The seeded asset is passed to the tab, which auto-pulls WO failures and fits.
    const seedAppliedRef = useRef(false);
    useEffect(() => {
        if (seedAppliedRef.current || !seed) return;
        seedAppliedRef.current = true;
        openTool(seed.tab || 'weibull');
    }, [seed, openTool]);

    // "Start here" pick: the shortlist chose the asset AND the tool its data can
    // carry, so the tool opens with that asset already selected — no blank picker.
    const [startAsset, setStartAsset] = useState<{ id: string; name: string; tag: string; criticality: string } | null>(null);
    const handleStartHere = useCallback((t: CalcTab, asset: { id: string; tag: string; name: string; criticality: string }) => {
        setStartAsset(asset);
        openTool(t);
    }, [openTool]);


    // Saved analyses state
    const [savedAnalyses, setSavedAnalyses] = useState<ReliabilityAnalysis[]>([]);
    const [savedStudies, setSavedStudies] = useState<ReliabilityStudy[]>([]);
    // What each study produced (0357) — the work its answer became.
    const [outcomes, setOutcomes] = useState<ReliabilityStudyOutcome[]>([]);
    const [showNewStudy, setShowNewStudy] = useState(false);
    /**
     * The study a tool run belongs to. Set when a tool is opened from a study's
     * plan, so the Save dialog does not ask again — the answer lands in the
     * study that asked the question.
     */
    const [studyContextId, setStudyContextId] = useState<string | null>(null);
    const openStudy = useCallback((id: string | null) => {
        if (onStudyChange) onStudyChange(id);
        setStudyContextId(id);
    }, [onStudyChange]);
    const [savedLoading, setSavedLoading] = useState(false);
    const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
    const [saveToast, setSaveToast] = useState<string | null>(null);

    // Modal states
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [editingAnalysis, setEditingAnalysis] = useState<ReliabilityAnalysis | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ReliabilityAnalysis | null>(null);

    // Collect current inputs/results from calculator — stored as refs
    const [currentInputs, setCurrentInputs] = useState<Record<string, any>>({});
    const [currentResults, setCurrentResults] = useState<Record<string, any>>({});
    const [currentAsset, setCurrentAsset] = useState<{ id: string; tag: string; name: string } | null>(null);

    // Persistent Weibull fit (drives the workflow spine + one-click Create PM)

    // Load saved analyses + studies
    const loadSavedAnalyses = useCallback(async () => {
        setSavedLoading(true);
        const [analyses, studies, outcomeRows] = await Promise.all([
            analyzeService.getReliabilityAnalyses(),
            analyzeService.getReliabilityStudies(),
            analyzeService.getStudyOutcomes(),
        ]);
        setSavedAnalyses(analyses);
        setSavedStudies(studies);
        setOutcomes(outcomeRows);
        setSavedLoading(false);
    }, []);

    useEffect(() => { loadSavedAnalyses(); }, [loadSavedAnalyses]);

    // Collapse to the current (highest) version per lineage — for the per-tab list
    const currentVersionAnalyses = useMemo(() => {
        const byRoot = new Map<string, ReliabilityAnalysis>();
        for (const a of savedAnalyses) {
            const root = a.root_id || a.id;
            const cur = byRoot.get(root);
            if (!cur || (a.version || 1) > (cur.version || 1)) byRoot.set(root, a);
        }
        return Array.from(byRoot.values());
    }, [savedAnalyses]);

    // Filter analyses by current tab (current versions only)
    const currentAnalysisType = CALC_TABS.find(t => t.id === activeCalc)?.analysisType;
    const filteredAnalyses = currentAnalysisType
        ? currentVersionAnalyses.filter(a => a.analysis_type === currentAnalysisType)
        : [];

    // Save handler — snapshots: append a version, never overwrite run data.
    // `study` carries the study assignment for a NEW lineage (existing id or a new name).
    const handleSave = useCallback(async (title: string, notes: string, study?: { studyId: string | null; newName?: string }) => {
        if (!currentAnalysisType) return;

        // Editing = metadata only (rename / re-note) on a specific version.
        if (editingAnalysis) {
            const updated = await analyzeService.updateReliabilityAnalysis(editingAnalysis.id, { title, notes });
            if (updated) {
                setSavedAnalyses(prev => prev.map(a => a.id === updated.id ? updated : a));
                setSaveToast('Study details updated ✓');
            }
            setEditingAnalysis(null);
            setTimeout(() => setSaveToast(null), 3000);
            return;
        }

        // If a study is loaded, append a new version to its lineage; otherwise start one.
        const active = activeAnalysisId ? savedAnalyses.find(a => a.id === activeAnalysisId) : null;

        // Resolve study assignment. Version appends inherit the lineage's study;
        // a fresh lineage uses the picker choice (existing id, a new study, or none).
        // A run started from a study's plan belongs to that study — do not ask.
        let targetStudyId: string | null = active ? (active.study_id ?? null) : (studyContextId ?? null);
        if (!active && !studyContextId && study) {
            if (study.newName?.trim()) {
                const createdStudy = await analyzeService.createReliabilityStudy({
                    name: study.newName.trim(),
                    asset_id: currentAsset?.id || null,
                    asset_tag: currentAsset?.tag || null,
                    asset_name: currentAsset?.name || null,
                    description: null,
                    created_by: currentAuthor,
                });
                if (createdStudy) {
                    setSavedStudies(prev => [createdStudy, ...prev]);
                    targetStudyId = createdStudy.id;
                }
            } else {
                targetStudyId = study.studyId ?? null;
            }
        }

        const payload = {
            study_id: targetStudyId,
            asset_id: currentAsset?.id || null,
            asset_tag: currentAsset?.tag || null,
            asset_name: currentAsset?.name || null,
            analysis_type: currentAnalysisType,
            title,
            inputs: currentInputs,
            results: currentResults,
            notes: notes || null,
            created_by: currentAuthor,
        };

        if (active) {
            const root = active.root_id || active.id;
            const nextVersion = Math.max(0, ...savedAnalyses
                .filter(a => (a.root_id || a.id) === root)
                .map(a => a.version || 1)) + 1;
            const saved = await analyzeService.saveReliabilityVersion(root, nextVersion, payload);
            if (saved) {
                setSavedAnalyses(prev => [saved, ...prev]);
                setActiveAnalysisId(saved.id);
                setSaveToast(`Saved as version ${nextVersion} ✓`);
            }
        } else {
            const saved = await analyzeService.saveReliabilityAnalysis(payload);
            if (saved) {
                setSavedAnalyses(prev => [saved, ...prev]);
                setActiveAnalysisId(saved.id);
                setSaveToast('Study saved ✓');
            }
        }
        setEditingAnalysis(null);
        setTimeout(() => setSaveToast(null), 3000);
    }, [currentAnalysisType, currentInputs, currentResults, currentAsset, editingAnalysis, currentAuthor, activeAnalysisId, savedAnalyses, studyContextId]);

    // Load handler — broadcast loaded inputs via state
    const [loadedData, setLoadedData] = useState<{ inputs: Record<string, any>; results: Record<string, any> } | null>(null);

    const handleLoad = useCallback((analysis: ReliabilityAnalysis) => {
        // Switch to the correct tool page
        const tab = CALC_TABS.find(t => t.analysisType === analysis.analysis_type);
        if (tab) openTool(tab.id);
        setActiveAnalysisId(analysis.id);
        setLoadedData({ inputs: analysis.inputs, results: analysis.results });
        setSaveToast(`Loaded: ${analysis.title}`);
        setTimeout(() => setSaveToast(null), 3000);
    }, [openTool]);

    const handleEdit = useCallback((analysis: ReliabilityAnalysis) => {
        setEditingAnalysis(analysis);
        handleLoad(analysis);
        setShowSaveModal(true);
    }, [handleLoad]);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        const ok = await analyzeService.deleteReliabilityAnalysis(deleteTarget.id);
        if (ok) {
            setSavedAnalyses(prev => prev.filter(a => a.id !== deleteTarget.id));
            if (activeAnalysisId === deleteTarget.id) setActiveAnalysisId(null);
            setSaveToast('Analysis deleted');
            setTimeout(() => setSaveToast(null), 3000);
        }
        setDeleteTarget(null);
    }, [deleteTarget, activeAnalysisId]);

    // Callbacks for child tabs to report their state
    const handleStateChange = useCallback((inputs: Record<string, any>, results: Record<string, any>, asset?: { id: string; tag: string; name: string } | null) => {
        setCurrentInputs(inputs);
        setCurrentResults(results);
        if (asset !== undefined) setCurrentAsset(asset);
    }, []);

    // Weibull-specific state change handler — also populates MC bridge
    const handleWeibullStateChange = useCallback((inputs: Record<string, any>, results: Record<string, any>, asset?: { id: string; tag: string; name: string } | null) => {
        setCurrentInputs(inputs);
        setCurrentResults(results);
        if (asset !== undefined) setCurrentAsset(asset);
        // Auto-bridge β/η (+ fit quality) to Monte Carlo whenever Weibull fit updates
        if (results?.beta && results?.eta) {
            setMcBridgeData(prev => {
                // Only update if values actually changed
                if (prev?.beta === results.beta && prev?.eta === results.eta) return prev;
                return { beta: results.beta, eta: results.eta, r2: results.r2, dataStr: inputs?.dataStr };
            });
        }
    }, []);

    // ★ Study lifecycle (0204): status transition + findings summary. Approval
    // stamps the approver; graceful toast if the migration isn't applied yet.
    const handleUpdateStudy = useCallback(async (id: string, updates: { status: import('../../eam/services/AnalyzeService').ReliabilityStudyStatus; findings: string }) => {
        const prev = savedStudies.find(s => s.id === id);
        // Page-side mirror of the 0358 guard so the refusal reads as a sentence,
        // not a 42501. The approver stamps are set by the database trigger.
        const entering = updates.status === 'approved' && prev?.status !== 'approved';
        const leaving = prev?.status === 'approved' && updates.status !== 'approved';
        if (prev && (entering || leaving) && !perms.canApproveStudy(prev)) {
            setSaveToast(entering
                ? (prev.created_by_user_id === perms.uid
                    ? 'A study is approved by someone other than its author (four-eyes) — send it for review and ask an approver.'
                    : 'Approval needs reliability approval rights, or an administrator.')
                : 'Reopening an approved study needs an approver or an administrator.');
            setTimeout(() => setSaveToast(null), 6000);
            return false;
        }
        const payload: Record<string, any> = prev?.status === 'approved' && updates.status === 'approved'
            ? {} // frozen: nothing to send
            : { status: updates.status, findings: updates.findings || null };
        if (Object.keys(payload).length === 0) {
            setSaveToast('The study is approved and frozen — reopen it to change the decision.');
            setTimeout(() => setSaveToast(null), 5000);
            return false;
        }
        const updated = await analyzeService.updateReliabilityStudy(id, payload);
        if (updated) {
            setSavedStudies(prevList => prevList.map(s => s.id === id ? updated : s));
            setSaveToast(updates.status === 'approved' ? 'Study approved ✓' : 'Study updated ✓');
            setTimeout(() => setSaveToast(null), 3000);
            return true;
        }
        setSaveToast('Update refused — you may not have the rights for this change (details in the console)');
        setTimeout(() => setSaveToast(null), 5000);
        return false;
    }, [savedStudies, perms]);

    // ★ New Study button (launcher): create the container up-front — analyses
    // saved later group under it via the Save dialog's study picker.
    const handleCreateStudy = useCallback(async (input: {
        name: string; description: string; objective: StudyObjective;
        asset: { id: string; tag: string; name: string } | null;
    }) => {
        const created = await analyzeService.createReliabilityStudy({
            name: input.name,
            asset_id: input.asset?.id || null,
            asset_tag: input.asset?.tag || null,
            asset_name: input.asset?.name || null,
            description: input.description || null,
            objective: input.objective,
            created_by: currentAuthor,
        });
        if (created) {
            setSavedStudies(prev => [created, ...prev]);
            // Straight into the study: it already knows its first step.
            openStudy(created.id);
            setSaveToast(`Study created — ${objectiveDef(input.objective).steps.length > 0 ? 'its plan is ready' : 'add analyses to it'} ✓`);
            setTimeout(() => setSaveToast(null), 4000);
            return true;
        }
        setSaveToast('Could not create the study — if this tenant has not had migration 0357 applied, the objective column is missing');
        setTimeout(() => setSaveToast(null), 6000);
        return false;
    }, [currentAuthor, openStudy]);

    // ── The study a run belongs to, and its asset ──────────────
    const activeStudy = useMemo(
        () => (studyId ? savedStudies.find(s => s.id === studyId) ?? null : null),
        [studyId, savedStudies],
    );
    const contextStudy = useMemo(
        () => (studyContextId ? savedStudies.find(s => s.id === studyContextId) ?? null : null),
        [studyContextId, savedStudies],
    );
    const outcomesFor = useCallback(
        (id: string | null) => (id ? outcomes.filter(o => o.study_id === id) : []),
        [outcomes],
    );

    /** Record what a study produced — only ever called after a CONFIRMED write. */
    const recordOutcome = useCallback(async (o: {
        kind: ReliabilityStudyOutcome['kind'];
        ref_id?: string | null;
        ref_label: string;
        detail?: Record<string, any>;
        analysis_id?: string | null;
    }) => {
        if (!studyContextId) return;
        const row = await analyzeService.recordStudyOutcome({
            study_id: studyContextId,
            created_by: currentAuthor,
            ...o,
        });
        if (row) { setOutcomes(prev => [row, ...prev]); return; }
        // The change itself succeeded — only the study's record of it did not.
        // Saying nothing here is the same dishonesty as M-4: the person sees
        // "applied ✓" while the study still reads "no work produced yet".
        setSaveToast('The change was applied, but this study could not record it — you may not have rights to write on this study. Ask a reliability engineer to add it.');
        setTimeout(() => setSaveToast(null), 7000);
    }, [studyContextId, currentAuthor]);

    // ★ Close the loop: when a PM program is created from a fit, stamp linked_pm_id
    // on the loaded study — or auto-save a snapshot so the link is never lost.
    // This is what lights the "✓ PM" badge on the Metrics bad-actor list (0154).
    const handlePMCreated = useCallback(async (pmId: string, pmTitle: string) => {
        if (activeAnalysisId) {
            const updated = await analyzeService.linkPMToAnalysis(activeAnalysisId, pmId, pmTitle);
            if (updated) {
                setSavedAnalyses(prev => prev.map(a => a.id === updated.id ? updated : a));
                setSaveToast(`PM "${pmTitle}" linked to this study ✓`);
                recordOutcome({ kind: 'pm', ref_id: pmId, ref_label: pmTitle, analysis_id: activeAnalysisId });
            }
        } else if (currentAnalysisType) {
            const saved = await analyzeService.saveReliabilityAnalysis({
                study_id: studyContextId,
                asset_id: currentAsset?.id || null,
                asset_tag: currentAsset?.tag || null,
                asset_name: currentAsset?.name || null,
                analysis_type: currentAnalysisType,
                title: `${currentAnalysisType.toUpperCase()} — basis for ${pmTitle}`,
                inputs: currentInputs,
                results: currentResults,
                notes: `Auto-saved when PM program "${pmTitle}" was created from this analysis.`,
                linked_pm_id: pmId,
                linked_pm_title: pmTitle,
                created_by: currentAuthor,
            });
            if (saved) {
                setSavedAnalyses(prev => [saved, ...prev]);
                setActiveAnalysisId(saved.id);
                setSaveToast(`PM created — study auto-saved & linked ✓`);
                recordOutcome({ kind: 'pm', ref_id: pmId, ref_label: pmTitle, analysis_id: saved.id });
            }
        }
        setTimeout(() => setSaveToast(null), 4000);
    }, [activeAnalysisId, currentAnalysisType, currentAsset, currentInputs, currentResults, currentAuthor, recordOutcome]);

    // ★ P2.1 + P2.2: Cross-tab data bridges
    const [bridgeData, setBridgeData] = useState<{ inputs: Record<string, any>; results: Record<string, any> } | null>(null);

    // P2.1: RBD → RAM Dashboard bridge
    const handleSendToRAM = useCallback((systemMtbf: number, systemMttr: number, systemAo: number) => {
        // Pre-populate RAM Dashboard inputs from RBD system metrics
        const ramInputs = {
            totalHours: '8760',
            failures: String(Math.max(1, Math.round(8760 / systemMtbf))),
            repairTimesStr: String(systemMttr),
            confidence: 90,
            mldt: '2',
            targetAo: String(Math.round(systemAo * 100)),
        };
        setBridgeData({ inputs: ramInputs, results: {} });
        openTool('ram');
        setActiveAnalysisId(null);
        setSaveToast(`[U+1F4CA] RAM Dashboard pre-populated — System MTBF: ${Math.round(systemMtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, [openTool]);

    // P2.2: RAM → Spares Demand bridge
    const handleSendToSpares = useCallback((mtbf: number) => {
        const sparesInputs = {
            mtbfVal: String(Math.round(mtbf)),
            population: '10',
            interval: '2160',
            confidence: '95',
        };
        setBridgeData({ inputs: sparesInputs, results: {} });
        openTool('spares');
        setActiveAnalysisId(null);
        setSaveToast(`[U+1F4E6] Spares Demand pre-populated — MTBF: ${Math.round(mtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, [openTool]);

    // Resolve which loaded data to use: bridge data takes precedence
    const effectiveLoadedData = bridgeData || loadedData;

    // Monte Carlo bridge data (from Weibull tab)
    const [mcBridgeData, setMcBridgeData] = useState<{ beta: number; eta: number; r2?: number; dataStr?: string } | null>(null);

    // P2.3: Weibull → Monte Carlo bridge
    const handleSendToMonteCarlo = useCallback((beta: number, eta: number, dataStr?: string) => {
        setMcBridgeData({ beta, eta, dataStr });
        openTool('montecarlo');
        setActiveAnalysisId(null);
        setSaveToast(`🎲 Monte Carlo pre-populated — β=${beta}, η=${eta.toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, [openTool]);

    // P2.4: Monte Carlo → RAM bridge (reuse existing handleSendToRAM)
    const handleMCToRAM = useCallback((mtbf: number, mttr: number, ao: number) => {
        const ramInputs = {
            totalHours: '8760',
            failures: String(Math.max(1, Math.round(8760 / mtbf))),
            repairTimesStr: String(mttr),
            confidence: 90,
            mldt: '2',
            targetAo: String(Math.round(ao * 100)),
        };
        setBridgeData({ inputs: ramInputs, results: {} });
        openTool('ram');
        setActiveAnalysisId(null);
        setSaveToast(`📊 RAM Dashboard pre-populated — Simulated MTBF: ${Math.round(mtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, [openTool]);

    // Clear general bridge data when user manually switches tools, but KEEP mcBridgeData
    const handleTabSwitch = useCallback((tabId: CalcTab | null) => {
        openTool(tabId);
        setActiveAnalysisId(null);
        setLoadedData(null);
        setBridgeData(null);
        // mcBridgeData intentionally NOT cleared — persists across tool navigation
    }, [openTool]);

    // Propagate context to parent for cross-module navigation
    useEffect(() => {
        onContextChange?.({
            asset: currentAsset,
            results: currentResults,
            activeTab: activeCalc,
        });
    }, [currentAsset, currentResults, activeCalc, onContextChange]);

    const focusTab = activeCalc ? CALC_TABS.find(t => t.id === activeCalc) ?? null : null;

    // The asset a tool opens on: a "Start here" pick, else a drill-through seed.
    // Every tab takes it, so no entry point ever lands the user on a blank picker.
    const entryAsset = startAsset ?? seed?.asset ?? null;

    // Analyses belonging to the open study — the workspace ticks its plan off these.
    const studyAnalyses = useMemo(
        () => (activeStudy ? savedAnalyses.filter(a => a.study_id === activeStudy.id) : []),
        [activeStudy, savedAnalyses],
    );

    // Open a tool from a study's plan: the study owns the run, and its asset
    // seeds the tool so the step starts where the study is pointed.
    const handleStudyOpenTool = useCallback((t: CalcTab) => {
        if (activeStudy?.asset_id) {
            setStartAsset({
                id: activeStudy.asset_id,
                tag: activeStudy.asset_tag || '',
                name: activeStudy.asset_name || activeStudy.asset_tag || '',
                criticality: '',
            });
        }
        setStudyContextId(activeStudy?.id ?? null);
        handleTabSwitch(t);
    }, [activeStudy, handleTabSwitch]);

    const handlePickTool = useCallback((t: CalcTab) => {
        setStudyContextId(null);
        handleTabSwitch(t);
    }, [handleTabSwitch]);

    /** The tools rail — the same five tools, off to the side and out of the way. */
    const ToolsRail = (
        <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">Analysis tools</p>
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100 overflow-hidden">
                {CALC_TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => handlePickTool(tab.id)}
                        title={tab.desc}
                        className="group w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-primary-50/50 transition-colors"
                    >
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-100 text-slate-500 transition-colors group-hover:bg-white group-hover:text-primary-600">
                            {tab.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-slate-700 group-hover:text-primary-700 transition-colors">{tab.label}</span>
                            <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{tab.question}</span>
                        </span>
                    </button>
                ))}
            </div>
            <p className="text-[10px] text-slate-400 px-1 leading-relaxed">
                A study asks for only the tools its decision needs. These stay open to anyone who wants to run one on its own.
            </p>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* View-only state (audit M-5): say so once, up front, instead of
                offering Save / Create PM / Apply that the database will refuse. */}
            {!perms.canEdit && (
                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                    <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                    <span>
                        <strong>View only.</strong> You can run every calculator and read every study; saving studies, creating PM programs and
                        changing stock levels need reliability, PM or inventory edit rights.
                        {perms.canApprove && ' You may approve or reopen studies sent for review.'}
                    </span>
                </div>
            )}
            {/* ── Launcher / study workspace: one centred reading column with the
                tools off to the side. A tool, when opened, takes the full width
                because charts and diagrams need it. ── */}
            {!focusTab && (
                <div className="flex flex-col lg:flex-row gap-4 items-start">
                    <div className="min-w-0 flex-1 space-y-4 w-full">
                        {activeStudy ? (
                            /* A study, opened: its plan, its outcomes, its decision */
                            <ReliabilityStudyWorkspace
                                study={activeStudy}
                                analyses={studyAnalyses}
                                outcomes={outcomesFor(activeStudy.id)}
                                onBack={() => openStudy(null)}
                                onOpenTool={handleStudyOpenTool}
                                onOpenAnalysis={handleLoad}
                                onSaveDecision={async ({ findings, status }) => handleUpdateStudy(activeStudy.id, { status, findings })}
                                canEdit={perms.canEditStudy(activeStudy)}
                                canApprove={perms.canApproveStudy(activeStudy)}
                            />
                        ) : (
                            <>
                                {/* New study sits at the top — the action, not a footnote */}
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Where to start</p>
                                    {perms.canEdit && (
                                        <button
                                            onClick={() => setShowNewStudy(true)}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary-600 text-white text-xs font-bold shadow-sm hover:bg-primary-700 transition-colors"
                                        >
                                            <Plus size={14} /> New study
                                        </button>
                                    )}
                                </div>

                                {/* 1. Where your own failure history says to look */}
                                <ReliabilityStartHere onStart={handleStartHere} />

                                {/* 2. The register of studies and what they produced */}
                                <StudyRecordsPanel
                                    analyses={savedAnalyses}
                                    studies={savedStudies}
                                    outcomes={outcomes}
                                    loading={savedLoading}
                                    onLoad={handleLoad}
                                    onUpdateStudy={perms.canEdit || perms.canApprove ? handleUpdateStudy : undefined}
                                    onOpenStudy={openStudy}
                                />
                            </>
                        )}
                    </div>

                    {/* Tools rail — right at lg+, stacked underneath below it */}
                    <aside className="w-full lg:w-[290px] xl:w-[320px] shrink-0">
                        {ToolsRail}
                    </aside>
                </div>
            )}

            {/* ── Focus mode: the selected tool IS the page — slim switch bar,
                back link to the launcher, Save pinned right ── */}
            {focusTab && contextStudy && (
                <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 rounded-xl border border-primary-200 bg-primary-50/70">
                    <span className="text-[11px] text-primary-700">
                        Working in <strong>{contextStudy.name}</strong> - what you save here lands in this study.
                    </span>
                    <button
                        onClick={() => { handleTabSwitch(null); openStudy(contextStudy.id); }}
                        className="ml-auto shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700"
                    >
                        Back to the study
                    </button>
                </div>
            )}

            {focusTab && (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => { setStudyContextId(null); handleTabSwitch(null); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white border-slate-200 text-slate-500 text-xs font-semibold hover:border-primary-300 hover:text-primary-600 transition-all"
                        title="Back to study records & all tools"
                    >
                        ← All tools
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                        {CALC_TABS.map(tab => {
                            const active = activeCalc === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => handleTabSwitch(tab.id)}
                                    title={tab.desc}
                                    aria-pressed={active}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${active
                                        ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-primary-300 hover:text-primary-600'
                                        }`}
                                >
                                    {tab.icon}
                                    <span className="whitespace-nowrap">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Save button — pinned outside scroll horizon; only for people who may write */}
                    {currentAnalysisType && perms.canEdit && (
                        <button
                            onClick={() => { setEditingAnalysis(null); setShowSaveModal(true); }}
                            title={activeAnalysisId ? 'Save the current state as a new dated version' : 'Save this study'}
                            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 rounded-lg shadow-sm hover:shadow-md transition-all"
                        >
                            <Save size={13} />
                            <span className="hidden sm:inline">{activeAnalysisId ? 'Save version' : 'Save'}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Toast notification */}
            {saveToast && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-50 border border-primary-200 rounded-xl text-sm text-primary-700 font-medium animate-in slide-in-from-top duration-200">
                    <Check size={16} className="text-primary-500" />
                    {saveToast}
                </div>
            )}

            {/* Saved Analyses Panel */}
            {currentAnalysisType && (
                <SavedAnalysesPanel
                    analyses={filteredAnalyses}
                    activeId={activeAnalysisId}
                    onLoad={handleLoad}
                    onEdit={perms.canEdit ? handleEdit : () => setSaveToast('View only — saving and editing analyses needs reliability edit rights')}
                    onDelete={perms.canEdit ? setDeleteTarget : () => setSaveToast('View only — deleting analyses needs reliability edit rights')}
                    loading={savedLoading}
                />
            )}

            {/* Content */}
            {activeCalc === 'ram' && <RAMDashboardTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} initialAsset={entryAsset} onSendToSpares={handleSendToSpares} />}
            {activeCalc === 'weibull' && <WeibullTab onStateChange={handleWeibullStateChange} loadedData={effectiveLoadedData} initialAsset={entryAsset} onPMCreated={handlePMCreated}
                onSentToRcm={info => recordOutcome({ kind: 'rcm', ref_id: null, ref_label: `RCM study seeded for ${info.assetTag}`, detail: { beta: info.beta, eta: info.eta } })} />}
            {activeCalc === 'spares' && <SparesTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} initialAsset={entryAsset}
                onMinLevelApplied={item => recordOutcome({ kind: 'spares', ref_id: item.id, ref_label: `Min ${item.minLevel} on ${item.code}`, detail: { min_level: item.minLevel, part: item.code } })} />}
            {activeCalc === 'rbd' && <ReliabilityModelingTab onStateChange={handleStateChange} onSendToRAM={handleSendToRAM} pidEntry={pidEntry} />}
            {activeCalc === 'montecarlo' && <MonteCarloSimTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} initialAsset={entryAsset} bridgeData={mcBridgeData} onSendToRAM={handleMCToRAM} onPMCreated={handlePMCreated} />}

            {/* Save Modal */}
            <SaveAnalysisModal
                isOpen={showSaveModal}
                onClose={() => { setShowSaveModal(false); setEditingAnalysis(null); }}
                onSave={handleSave}
                analysisType={currentAnalysisType || 'mtbf'}
                editingId={editingAnalysis?.id || null}
                initialTitle={editingAnalysis?.title}
                initialNotes={editingAnalysis?.notes || ''}
                showStudyPicker={!editingAnalysis && !activeAnalysisId && !studyContextId}
                studies={currentAsset?.id
                    ? savedStudies.filter(s => s.asset_id === currentAsset.id)
                    : savedStudies}
                defaultStudyName={`${currentAsset?.tag || 'Asset'} Reliability Study — ${new Date().toLocaleDateString()}`}
            />

            {/* New study — asks the decision it is for, then opens its plan */}
            <NewStudyModal
                open={showNewStudy}
                onClose={() => setShowNewStudy(false)}
                onCreate={handleCreateStudy}
                initialAsset={startAsset}
            />

            {/* Delete Confirmation */}
            <DeleteConfirm
                isOpen={!!deleteTarget}
                title={deleteTarget?.title || ''}
                onConfirm={handleDelete}
                onCancel={() => setDeleteTarget(null)}
            />

        </div>
    );
};

export default ReliabilityModellingDivision;
