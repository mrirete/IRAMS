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
import React, { useState, useEffect, useCallback } from 'react';
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
import type { ReliabilityAnalysis, ReliabilityAnalysisType } from '../../eam/services/AnalyzeService';

type CalcTab = 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';

const CALC_TABS: { id: CalcTab; label: string; icon: React.ReactNode; phase: string; desc: string; analysisType?: ReliabilityAnalysisType }[] = [
    { id: 'rbd', label: 'Block Diagrams', icon: <Cpu size={14} />, phase: 'Model', desc: 'Reliability Block Diagrams & P&ID system modelling' },
    { id: 'ram', label: 'RAM Dashboard', icon: <Activity size={14} />, phase: 'Measure', desc: 'Reliability, Availability & Maintainability — unified MTBF/MTTR/Ao analysis', analysisType: 'mtbf' },
    { id: 'weibull', label: 'Weibull', icon: <TrendingUp size={14} />, phase: 'Predict', desc: 'Life data analysis — B-life values, failure pattern characterization', analysisType: 'weibull' },
    { id: 'montecarlo', label: 'Monte Carlo', icon: <Dices size={14} />, phase: 'Simulate', desc: 'Probabilistic lifecycle simulation — Weibull failures, PM optimization, P10/P50/P90 forecasting', analysisType: 'montecarlo' },
    { id: 'spares', label: 'Spares Demand', icon: <Package size={14} />, phase: 'Predict', desc: 'Poisson-based spare parts stocking recommendation', analysisType: 'spares' },
];

// ─── Save Analysis Modal ──────────────────────────────────────
function SaveAnalysisModal({ isOpen, onClose, onSave, analysisType, editingId }: {
    isOpen: boolean;
    onClose: () => void;
    onSave: (title: string, notes: string) => void;
    analysisType: ReliabilityAnalysisType;
    editingId: string | null;
}) {
    const [title, setTitle] = useState('');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (!editingId) {
                const typeLabel = analysisType.toUpperCase();
                setTitle(`${typeLabel} Analysis — ${new Date().toLocaleDateString()}`);
            }
            setNotes('');
        }
    }, [isOpen, analysisType, editingId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800">
                        {editingId ? '✏️ Update Analysis' : '[U+1F4BE] Save Analysis'}
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                </div>
                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                            placeholder="e.g. GT-301 MTBF Analysis Q1 2026" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)}
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                            placeholder="Add context, assumptions, or remarks..." />
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button onClick={() => { onSave(title, notes); onClose(); }}
                        disabled={!title.trim()}
                        className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50">
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
                    <FolderOpen size={16} className="text-teal-500" />
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
                            className={`flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${a.id === activeId ? 'bg-teal-50 border-l-2 border-teal-500' : ''}`}>
                            <div className="flex-1 min-w-0">
                                <p className={`font-medium truncate ${a.id === activeId ? 'text-teal-700' : 'text-slate-700'}`}>{a.title}</p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                    <span className="px-1.5 py-0.5 bg-slate-100 rounded font-medium uppercase">{a.analysis_type}</span>
                                    {a.asset_tag && <span>[U+1F4CC] {a.asset_tag}</span>}
                                    <span><Clock size={9} className="inline" /> {new Date(a.updated_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => onLoad(a)} title="Load"
                                    className={`p-1.5 rounded-lg transition-colors ${a.id === activeId ? 'text-teal-600 bg-teal-100' : 'text-slate-400 hover:text-teal-600 hover:bg-teal-50'}`}>
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
}

export const ReliabilityModellingDivision: React.FC<DivisionProps> = ({ onContextChange }) => {
    const [activeCalc, setActiveCalc] = useState<CalcTab>('ram');


    // Saved analyses state
    const [savedAnalyses, setSavedAnalyses] = useState<ReliabilityAnalysis[]>([]);
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

    // Load saved analyses
    const loadSavedAnalyses = useCallback(async () => {
        setSavedLoading(true);
        const analyses = await analyzeService.getReliabilityAnalyses();
        setSavedAnalyses(analyses);
        setSavedLoading(false);
    }, []);

    useEffect(() => { loadSavedAnalyses(); }, [loadSavedAnalyses]);

    // Filter analyses by current tab
    const currentAnalysisType = CALC_TABS.find(t => t.id === activeCalc)?.analysisType;
    const filteredAnalyses = currentAnalysisType
        ? savedAnalyses.filter(a => a.analysis_type === currentAnalysisType)
        : [];

    // Save handler
    const handleSave = useCallback(async (title: string, notes: string) => {
        if (!currentAnalysisType) return;

        if (editingAnalysis) {
            // Update existing
            const updated = await analyzeService.updateReliabilityAnalysis(editingAnalysis.id, {
                title, notes,
                inputs: currentInputs,
                results: currentResults,
            });
            if (updated) {
                setSavedAnalyses(prev => prev.map(a => a.id === updated.id ? updated : a));
                setSaveToast('Analysis updated ✓');
            }
        } else {
            // Create new
            const saved = await analyzeService.saveReliabilityAnalysis({
                asset_id: currentAsset?.id || null,
                asset_tag: currentAsset?.tag || null,
                asset_name: currentAsset?.name || null,
                analysis_type: currentAnalysisType,
                title,
                inputs: currentInputs,
                results: currentResults,
                notes: notes || null,
                created_by: null,
            });
            if (saved) {
                setSavedAnalyses(prev => [saved, ...prev]);
                setActiveAnalysisId(saved.id);
                setSaveToast('Analysis saved ✓');
            }
        }
        setEditingAnalysis(null);
        setTimeout(() => setSaveToast(null), 3000);
    }, [currentAnalysisType, currentInputs, currentResults, currentAsset, editingAnalysis]);

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
        // Auto-bridge β/η to Monte Carlo whenever Weibull fit updates
        if (results?.beta && results?.eta) {
            setMcBridgeData(prev => {
                // Only update if values actually changed
                if (prev?.beta === results.beta && prev?.eta === results.eta) return prev;
                return { beta: results.beta, eta: results.eta, dataStr: inputs?.dataStr };
            });
        }
    }, []);

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
    const [mcBridgeData, setMcBridgeData] = useState<{ beta: number; eta: number; dataStr?: string } | null>(null);

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
            {/* Calculator sub-tab bar */}
            <div className="-mx-1 px-1" style={{ overflow: 'visible' }}>
                <div className="flex items-center gap-1 bg-white/80 backdrop-blur-sm p-1 rounded-xl border border-slate-200/60 shadow-sm min-w-max">
                    {CALC_TABS.map(tab => (
                        <div key={tab.id} style={{ position: 'relative' }}
                            onMouseEnter={e => {
                                const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement;
                                if (tip) tip.style.opacity = '1';
                            }}
                            onMouseLeave={e => {
                                const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement;
                                if (tip) tip.style.opacity = '0';
                            }}
                        >
                            <button
                                onClick={() => handleTabSwitch(tab.id)}
                                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-medium transition-all whitespace-nowrap ${activeCalc === tab.id
                                    ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-md shadow-teal-500/20'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                <span className={`transition-colors ${activeCalc === tab.id ? 'text-white/90' : 'text-slate-400'}`}>{tab.icon}</span>
                                <span>{tab.label}</span>
                            </button>
                            {/* Tooltip — appears ABOVE the button to avoid overflow clipping */}
                            <div data-tooltip style={{
                                position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                                bottom: '100%', marginBottom: 10,
                                zIndex: 50, pointerEvents: 'none',
                                opacity: 0, transition: 'opacity 0.2s ease',
                            }}>
                                <div style={{
                                    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                                    border: '1px solid #334155',
                                    borderRadius: 12,
                                    padding: '12px 16px',
                                    maxWidth: 280,
                                    minWidth: 180,
                                    boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25)',
                                    position: 'relative' as const,
                                }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#22d3ee', marginBottom: 4, letterSpacing: '0.02em' }}>
                                        {tab.phase}
                                    </div>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: '#cbd5e1', lineHeight: 1.5 }}>
                                        {tab.desc}
                                    </div>
                                    {/* Arrow pointing DOWN */}
                                    <div style={{
                                        position: 'absolute' as const, bottom: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
                                        width: 10, height: 10,
                                        background: '#1e293b', borderRight: '1px solid #334155', borderBottom: '1px solid #334155',
                                    }} />
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Save button inline */}
                    {currentAnalysisType && (
                        <button
                            onClick={() => { setEditingAnalysis(null); setShowSaveModal(true); }}
                            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-500 rounded-lg shadow-sm hover:shadow-md transition-all"
                        >
                            <Save size={13} />
                            {activeAnalysisId ? 'Save As New' : 'Save Analysis'}
                        </button>
                    )}
                </div>
            </div>

            {/* Toast notification */}
            {saveToast && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-700 font-medium animate-in slide-in-from-top duration-200">
                    <Check size={16} className="text-teal-500" />
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
            {activeCalc === 'weibull' && <WeibullTab onStateChange={handleWeibullStateChange} loadedData={effectiveLoadedData} />}
            {activeCalc === 'spares' && <SparesTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} />}
            {activeCalc === 'rbd' && <ReliabilityModelingTab onStateChange={handleStateChange} onSendToRAM={handleSendToRAM} />}
            {activeCalc === 'montecarlo' && <MonteCarloSimTab onStateChange={handleStateChange} loadedData={effectiveLoadedData} bridgeData={mcBridgeData} onSendToRAM={handleMCToRAM} />}

            {/* Save Modal */}
            <SaveAnalysisModal
                isOpen={showSaveModal}
                onClose={() => { setShowSaveModal(false); setEditingAnalysis(null); }}
                onSave={handleSave}
                analysisType={currentAnalysisType || 'mtbf'}
                editingId={editingAnalysis?.id || null}
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
