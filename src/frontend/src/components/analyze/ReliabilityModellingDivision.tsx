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
    Save, FolderOpen, Trash2, Edit3, Clock, ChevronDown, ChevronUp,
    AlertCircle, Check, X,
} from 'lucide-react';

// Individual calculator tabs exported from the Toolkit
import {
    RAMDashboardTab,
    WeibullTab,
    SparesTab,
} from '../../eam/pages/ReliabilityToolkit';

// RBD / P&ID modeling
import ReliabilityModelingTab from './ReliabilityModelingTab';

// Monte Carlo
import { MonteCarloSimTab } from '../../eam/components/MonteCarloSimTab';

// Service
import analyzeService from '../../eam/services/AnalyzeService';
import type { ReliabilityAnalysis, ReliabilityAnalysisType, ReliabilityStudy } from '../../eam/services/AnalyzeService';
import { useAuth } from '../../eam/contexts/AuthContext';
import { StudyRecordsPanel } from './ReliabilityStudyRecords';

type CalcTab = 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';

// Each tool is labelled by the QUESTION it answers (purpose), not a lifecycle
// phase — so the strip reads as a parallel palette, not a Model→…→Simulate pipeline.
// `outcome` states the ACTION the tool's result becomes — the answer to
// "why am I doing this?" shown on every card.
const CALC_TABS: { id: CalcTab; label: string; icon: React.ReactNode; purpose: string; outcome: string; desc: string; analysisType?: ReliabilityAnalysisType }[] = [
    { id: 'rbd', label: 'Block Diagrams', icon: <Cpu size={14} />, purpose: 'System model', outcome: '→ weakest-link ranking', desc: 'Reliability Block Diagrams & P&ID system modelling' },
    { id: 'ram', label: 'RAM Dashboard', icon: <Activity size={14} />, purpose: 'Reliability & availability', outcome: '→ availability baseline', desc: 'Reliability, Availability & Maintainability — unified MTBF/MTTR/Ao analysis', analysisType: 'mtbf' },
    { id: 'weibull', label: 'Weibull', icon: <TrendingUp size={14} />, purpose: 'Failure pattern & life', outcome: '→ PM program / RCM study', desc: 'Life data analysis — B-life values, failure pattern characterization', analysisType: 'weibull' },
    { id: 'montecarlo', label: 'Monte Carlo', icon: <Dices size={14} />, purpose: 'Risk forecast', outcome: '→ PM interval decision', desc: 'Probabilistic lifecycle simulation — Weibull failures, PM optimization, P10/P50/P90 forecasting', analysisType: 'montecarlo' },
    { id: 'spares', label: 'Spares Demand', icon: <Package size={14} />, purpose: 'Spares to stock', outcome: '→ inventory min level', desc: 'Poisson-based spare parts stocking recommendation', analysisType: 'spares' },
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
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
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
        activeTab: CalcTab;
    }) => void;
    /** Drill-through seed (e.g. Metrics bad actor → Fit Weibull): opens a tab with an asset pre-selected. */
    seed?: { asset: { id: string; name: string; tag: string; criticality: string } | null; tab?: CalcTab } | null;
}

export const ReliabilityModellingDivision: React.FC<DivisionProps> = ({ onContextChange, seed }) => {
    const { profile, user } = useAuth();
    // Human-readable author stamped on saved studies (falls back gracefully).
    const currentAuthor = profile?.username || profile?.fullName || user?.email || null;

    const [activeCalc, setActiveCalc] = useState<CalcTab>('ram');

    // Apply a drill-through seed once: open the requested tab (default Weibull).
    // The seeded asset is passed to the tab, which auto-pulls WO failures and fits.
    const seedAppliedRef = useRef(false);
    useEffect(() => {
        if (seedAppliedRef.current || !seed) return;
        seedAppliedRef.current = true;
        setActiveCalc(seed.tab || 'weibull');
    }, [seed]);


    // Saved analyses state
    const [savedAnalyses, setSavedAnalyses] = useState<ReliabilityAnalysis[]>([]);
    const [savedStudies, setSavedStudies] = useState<ReliabilityStudy[]>([]);
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
        const [analyses, studies] = await Promise.all([
            analyzeService.getReliabilityAnalyses(),
            analyzeService.getReliabilityStudies(),
        ]);
        setSavedAnalyses(analyses);
        setSavedStudies(studies);
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
        let studyId: string | null = active ? (active.study_id ?? null) : null;
        if (!active && study) {
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
                    studyId = createdStudy.id;
                }
            } else {
                studyId = study.studyId ?? null;
            }
        }

        const payload = {
            study_id: studyId,
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
    }, [currentAnalysisType, currentInputs, currentResults, currentAsset, editingAnalysis, currentAuthor, activeAnalysisId, savedAnalyses]);

    // Load handler — broadcast loaded inputs via state
    const [loadedData, setLoadedData] = useState<{ inputs: Record<string, any>; results: Record<string, any> } | null>(null);

    const handleLoad = useCallback((analysis: ReliabilityAnalysis) => {
        // Switch to the correct tab
        const tab = CALC_TABS.find(t => t.analysisType === analysis.analysis_type);
        if (tab) setActiveCalc(tab.id);
        setActiveAnalysisId(analysis.id);
        setLoadedData({ inputs: analysis.inputs, results: analysis.results });
        setSaveToast(`Loaded: ${analysis.title}`);
        setTimeout(() => setSaveToast(null), 3000);
    }, []);

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
        const payload: Record<string, any> = { status: updates.status, findings: updates.findings || null };
        const prev = savedStudies.find(s => s.id === id);
        if (updates.status === 'approved' && prev?.status !== 'approved') {
            payload.approved_by = currentAuthor;
            payload.approved_at = new Date().toISOString();
        }
        const updated = await analyzeService.updateReliabilityStudy(id, payload);
        if (updated) {
            setSavedStudies(prevList => prevList.map(s => s.id === id ? updated : s));
            setSaveToast(updates.status === 'approved' ? 'Study approved ✓' : 'Study updated ✓');
            setTimeout(() => setSaveToast(null), 3000);
            return true;
        }
        setSaveToast('Update failed — apply migration 0204 (study lifecycle), then retry');
        setTimeout(() => setSaveToast(null), 5000);
        return false;
    }, [savedStudies, currentAuthor]);

    // ★ Close the loop: when a PM program is created from a fit, stamp linked_pm_id
    // on the loaded study — or auto-save a snapshot so the link is never lost.
    // This is what lights the "✓ PM" badge on the Metrics bad-actor list (0154).
    const handlePMCreated = useCallback(async (pmId: string, pmTitle: string) => {
        if (activeAnalysisId) {
            const updated = await analyzeService.linkPMToAnalysis(activeAnalysisId, pmId, pmTitle);
            if (updated) {
                setSavedAnalyses(prev => prev.map(a => a.id === updated.id ? updated : a));
                setSaveToast(`PM "${pmTitle}" linked to this study ✓`);
            }
        } else if (currentAnalysisType) {
            const saved = await analyzeService.saveReliabilityAnalysis({
                study_id: null,
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
            }
        }
        setTimeout(() => setSaveToast(null), 4000);
    }, [activeAnalysisId, currentAnalysisType, currentAsset, currentInputs, currentResults, currentAuthor]);

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
        setActiveCalc('ram');
        setActiveAnalysisId(null);
        setSaveToast(`[U+1F4CA] RAM Dashboard pre-populated — System MTBF: ${Math.round(systemMtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, []);

    // P2.2: RAM → Spares Demand bridge
    const handleSendToSpares = useCallback((mtbf: number) => {
        const sparesInputs = {
            mtbfVal: String(Math.round(mtbf)),
            population: '10',
            interval: '2160',
            confidence: '95',
        };
        setBridgeData({ inputs: sparesInputs, results: {} });
        setActiveCalc('spares');
        setActiveAnalysisId(null);
        setSaveToast(`[U+1F4E6] Spares Demand pre-populated — MTBF: ${Math.round(mtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, []);

    // Resolve which loaded data to use: bridge data takes precedence
    const effectiveLoadedData = bridgeData || loadedData;

    // Monte Carlo bridge data (from Weibull tab)
    const [mcBridgeData, setMcBridgeData] = useState<{ beta: number; eta: number; r2?: number; dataStr?: string } | null>(null);

    // P2.3: Weibull → Monte Carlo bridge
    const handleSendToMonteCarlo = useCallback((beta: number, eta: number, dataStr?: string) => {
        setMcBridgeData({ beta, eta, dataStr });
        setActiveCalc('montecarlo');
        setActiveAnalysisId(null);
        setSaveToast(`🎲 Monte Carlo pre-populated — β=${beta}, η=${eta.toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, []);

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
        setActiveCalc('ram');
        setActiveAnalysisId(null);
        setSaveToast(`📊 RAM Dashboard pre-populated — Simulated MTBF: ${Math.round(mtbf).toLocaleString()}h`);
        setTimeout(() => setSaveToast(null), 4000);
    }, []);

    // Clear general bridge data when user manually switches tabs, but KEEP mcBridgeData
    const handleTabSwitch = useCallback((tabId: CalcTab) => {
        setActiveCalc(tabId);
        setActiveAnalysisId(null);
        setLoadedData(null);
        setBridgeData(null);
        // mcBridgeData intentionally NOT cleared — persists across tab navigation
    }, []);

    // Propagate context to parent for cross-module navigation
    useEffect(() => {
        onContextChange?.({
            asset: currentAsset,
            results: currentResults,
            activeTab: activeCalc,
        });
    }, [currentAsset, currentResults, activeCalc, onContextChange]);

    return (
        <div className="space-y-4">
            {/* Study Records — consolidated dated register of every saved study */}
            <StudyRecordsPanel
                analyses={savedAnalyses}
                studies={savedStudies}
                loading={savedLoading}
                onLoad={handleLoad}
                onUpdateStudy={handleUpdateStudy}
            />


            {/* Calculator tools — a palette, not a pipeline. Each tool is a card
                labelled by the question it answers; open any, in any order. */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    {CALC_TABS.map(tab => {
                        const active = activeCalc === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => handleTabSwitch(tab.id)}
                                title={tab.desc}
                                aria-pressed={active}
                                className={`group flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-all ${active
                                    ? 'bg-primary-600 border-primary-600 text-white shadow-md shadow-primary-500/25'
                                    : 'bg-white border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50/40 hover:shadow-sm'
                                    }`}
                            >
                                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-primary-600'}`}>
                                    {tab.icon}
                                </span>
                                <span className="flex flex-col leading-tight">
                                    <span className="font-semibold text-[13px] whitespace-nowrap">{tab.label}</span>
                                    <span className={`text-[10px] whitespace-nowrap ${active ? 'text-white/85' : 'text-slate-400'}`}>{tab.purpose}</span>
                                    <span className={`text-[9px] font-semibold whitespace-nowrap ${active ? 'text-white/70' : 'text-emerald-600/80'}`}>{tab.outcome}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Save button — always visible, pinned outside scroll horizon */}
                {currentAnalysisType && (
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
                    onEdit={handleEdit}
                    onDelete={setDeleteTarget}
                    loading={savedLoading}
                />
            )}

            {/* Content */}
            {activeCalc === 'ram' && <RAMDashboardTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} onSendToSpares={handleSendToSpares} />}
            {activeCalc === 'weibull' && <WeibullTab onStateChange={handleWeibullStateChange} loadedData={effectiveLoadedData} initialAsset={seed?.asset} onPMCreated={handlePMCreated} />}
            {activeCalc === 'spares' && <SparesTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} />}
            {activeCalc === 'rbd' && <ReliabilityModelingTab onStateChange={handleStateChange} onSendToRAM={handleSendToRAM} />}
            {activeCalc === 'montecarlo' && <MonteCarloSimTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} bridgeData={mcBridgeData} onSendToRAM={handleMCToRAM} onPMCreated={handlePMCreated} />}

            {/* Save Modal */}
            <SaveAnalysisModal
                isOpen={showSaveModal}
                onClose={() => { setShowSaveModal(false); setEditingAnalysis(null); }}
                onSave={handleSave}
                analysisType={currentAnalysisType || 'mtbf'}
                editingId={editingAnalysis?.id || null}
                initialTitle={editingAnalysis?.title}
                initialNotes={editingAnalysis?.notes || ''}
                showStudyPicker={!editingAnalysis && !activeAnalysisId}
                studies={currentAsset?.id
                    ? savedStudies.filter(s => s.asset_id === currentAsset.id)
                    : savedStudies}
                defaultStudyName={`${currentAsset?.tag || 'Asset'} Reliability Study — ${new Date().toLocaleDateString()}`}
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
