import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    X, Clipboard, CheckCircle, Database, Loader2, Search,
    Server, Edit3,
} from 'lucide-react';
import { useAssetContext } from '../../contexts/AssetContext';
import { useConnectors } from '../../hooks/useConnectors';
import analyzeService from '../../eam/services/AnalyzeService';
import type { MaintenanceDataSummary } from '../../eam/services/AnalyzeService';

// ── Types ────────────────────────────────────────────────────
type AssessmentType = 'fmea' | 'rca' | 'criticality' | 'bad_actor';
type DataSourceMode = 'connected' | 'manual';

interface NewAssessmentForm {
    title: string;
    type: AssessmentType;
    asset_id: string;
    target_level: string;
    description: string;
    dataSourceMode: DataSourceMode;
    selectedConnectorId: string;
    maintenanceData: MaintenanceDataSummary | null;
}

const EMPTY_FORM: NewAssessmentForm = {
    title: '', type: 'fmea', asset_id: '', target_level: '', description: '',
    dataSourceMode: 'connected', selectedConnectorId: 'local', maintenanceData: null,
};

const TAXONOMY_BADGES: Record<string, { label: string; color: string }> = {
    site: { label: 'SITE', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    unit: { label: 'UNIT', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    system: { label: 'SYSTEM', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
    equipment: { label: 'EQUIP', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
    subunit: { label: 'SUBUNIT', color: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
    component: { label: 'COMP', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    location: { label: 'LOC', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
};

// ── Props ────────────────────────────────────────────────────
interface NewAssessmentModalProps {
    isOpen: boolean;
    initialType?: AssessmentType;
    initialAssetId?: string;
    initialTitle?: string;
    initialTargetLevel?: string;
    initialDescription?: string;
    onClose: () => void;
    onCreated: () => void;
}

// ── Component ────────────────────────────────────────────────
export const NewAssessmentModal: React.FC<NewAssessmentModalProps> = ({
    isOpen,
    initialType,
    initialAssetId,
    initialTitle,
    initialTargetLevel,
    initialDescription,
    onClose,
    onCreated,
}) => {
    const navigate = useNavigate();
    const { assets: allHierarchyAssets } = useAssetContext();
    const { connectors: hubConnectors } = useConnectors();

    const [assessmentForm, setAssessmentForm] = useState<NewAssessmentForm>({
        ...EMPTY_FORM,
        type: initialType || 'fmea',
        asset_id: initialAssetId || '',
        title: initialTitle || '',
        target_level: initialTargetLevel || '',
        description: initialDescription || '',
    });
    const [assessmentCreated, setAssessmentCreated] = useState(false);
    const [dataPulling, setDataPulling] = useState(false);
    const [dataPulled, setDataPulled] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [showAssetDropdown, setShowAssetDropdown] = useState(false);

    // Manual input fields
    const [manualWOCount, setManualWOCount] = useState('');
    const [manualFailureCount, setManualFailureCount] = useState('');
    const [manualMTBF, setManualMTBF] = useState('');
    const [manualMTTR, setManualMTTR] = useState('');
    const [manualFailureModes, setManualFailureModes] = useState('');
    const [manualNotes, setManualNotes] = useState('');

    // ── Derived data ─────────────────────────────────────────
    const hierarchyAssets = useMemo(() => {
        return allHierarchyAssets
            .map(a => ({
                id: a.id,
                tag: a.tag || '',
                name: a.name || '',
                taxonomy_level: (a as any).taxonomy_level || 'equipment',
                criticality: (a as any).criticality || 'C',
                site: (a as any).site || '',
            }))
            .sort((a, b) => {
                const order = ['site', 'unit', 'system', 'equipment', 'subunit', 'component', 'location'];
                const diff = order.indexOf(a.taxonomy_level) - order.indexOf(b.taxonomy_level);
                return diff !== 0 ? diff : a.tag.localeCompare(b.tag);
            });
    }, [allHierarchyAssets]);

    const filteredHierarchyAssets = useMemo(() => {
        if (!assetSearch.trim()) return hierarchyAssets.slice(0, 30);
        const q = assetSearch.toLowerCase();
        return hierarchyAssets.filter(a =>
            a.tag.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            a.taxonomy_level.toLowerCase().includes(q)
        ).slice(0, 30);
    }, [hierarchyAssets, assetSearch]);

    const runningConnectors = useMemo(() =>
        hubConnectors.filter(c => c.status === 'running'),
        [hubConnectors]);

    // ── Handlers ──────────────────────────────────────────────
    const handlePullData = useCallback(async () => {
        if (!assessmentForm.asset_id) return;
        setDataPulling(true);
        setDataPulled(false);
        try {
            const isLocal = assessmentForm.selectedConnectorId === 'local';
            const connector = !isLocal ? hubConnectors.find(c => c.connector_id === assessmentForm.selectedConnectorId) : null;
            const summary = await analyzeService.pullMaintenanceData(
                assessmentForm.asset_id,
                assessmentForm.target_level || 'equipment',
                isLocal ? 'local' : 'connector',
                connector?.connector_id,
                connector?.name || 'Local EAM Database',
            );
            setAssessmentForm(f => ({ ...f, maintenanceData: summary }));
            setDataPulled(true);
        } catch (err) {
            console.error('[NewAssessmentModal] Pull data error:', err);
        }
        setDataPulling(false);
    }, [assessmentForm.asset_id, assessmentForm.selectedConnectorId, assessmentForm.target_level, hubConnectors]);

    const handleBuildManualSummary = useCallback(() => {
        const modes = manualFailureModes.split(',').map(s => s.trim()).filter(Boolean);
        const summary: MaintenanceDataSummary = {
            source: 'manual',
            targetLevel: assessmentForm.target_level || 'equipment',
            totalWorkOrders: parseInt(manualWOCount) || 0,
            failureWorkOrders: parseInt(manualFailureCount) || 0,
            lastWODate: null,
            mtbfHours: parseFloat(manualMTBF) || null,
            mttrHours: parseFloat(manualMTTR) || null,
            topFailureModes: modes.map(mode => ({ mode, count: 1 })),
            workOrderSamples: [],
            manualNotes: manualNotes || undefined,
        };
        setAssessmentForm(f => ({ ...f, maintenanceData: summary }));
        setDataPulled(true);
    }, [manualWOCount, manualFailureCount, manualMTBF, manualMTTR, manualFailureModes, manualNotes, assessmentForm.target_level]);

    const handleCreateAssessment = useCallback(async () => {
        try {
            const { title, type, asset_id, description, maintenanceData } = assessmentForm;
            if (type === 'rca') {
                onClose();
                navigate('/analyze/rca/new', { state: { title, asset_id, description, maintenanceData } });
                return;
            } else if (type === 'fmea') {
                const ws = await analyzeService.createFMEAWorksheet({
                    asset_id, title, fmea_type: 'equipment', status: 'draft',
                    max_rpn: 0, avg_rpn: 0, high_risk_count: 0,
                });
                if (!ws) {
                    alert('Failed to create FMEA worksheet. Check that the database migration has been applied.');
                    return;
                }
                if (maintenanceData && ws.id) {
                    await analyzeService.saveAnalysisDataSource(ws.id, 'fmea', maintenanceData);
                }
            }
            setAssessmentCreated(true);
            onCreated();
            setTimeout(() => {
                setAssessmentCreated(false);
                setAssessmentForm(EMPTY_FORM);
                setDataPulled(false);
                setAssetSearch('');
                setManualWOCount(''); setManualFailureCount(''); setManualMTBF(''); setManualMTTR('');
                setManualFailureModes(''); setManualNotes('');
                onClose();
            }, 2000);
        } catch (err) {
            console.error('[NewAssessmentModal] Failed to create assessment:', err);
            alert('Failed to create assessment. Please try again.');
        }
    }, [assessmentForm, onCreated, onClose, navigate]);

    // Reset form on initial values change
    React.useEffect(() => {
        if (isOpen) {
            setAssessmentForm({
                ...EMPTY_FORM,
                type: initialType || 'fmea',
                asset_id: initialAssetId || '',
                title: initialTitle || '',
                target_level: initialTargetLevel || '',
                description: initialDescription || '',
            });
            setDataPulled(false);
            setAssessmentCreated(false);
        }
    }, [isOpen, initialType, initialAssetId, initialTitle, initialTargetLevel, initialDescription]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => !assessmentCreated && onClose()}>
            <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl shadow-black/50 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><Clipboard size={20} /></div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">Create New {assessmentForm.type === 'rca' ? 'RCA Investigation' : 'FMEA Worksheet'}</h2>
                            <p className="text-xs text-slate-500 mt-0.5">ISO 55000 · SAE JA1011 compliant</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                </div>

                {assessmentCreated ? (
                    <div className="p-12 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                        <div className="p-4 bg-accent-safe/10 rounded-2xl text-accent-safe ring-4 ring-accent-safe/10"><CheckCircle size={40} /></div>
                        <h3 className="text-lg font-bold text-slate-800">Analysis Created</h3>
                        <p className="text-sm text-slate-500">Redirecting to your new analysis…</p>
                    </div>
                ) : (
                    <div className="p-6 space-y-5">

                        {/* ── 1. Title ─────────────────────────────── */}
                        <div>
                            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Title *</label>
                            <input
                                value={assessmentForm.title}
                                onChange={e => setAssessmentForm(f => ({ ...f, title: e.target.value }))}
                                placeholder="e.g. K-601 Compressor Vibration Failure"
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-relantern-500/30"
                            />
                        </div>

                        {/* ── 2. Target (Asset Hierarchy Picker) ──── */}
                        <div className="relative">
                            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Target (System / Equipment / Component / Location) *</label>
                            {assessmentForm.asset_id ? (
                                <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5">
                                    {(() => {
                                        const sel = hierarchyAssets.find(a => a.id === assessmentForm.asset_id);
                                        const badge = TAXONOMY_BADGES[sel?.taxonomy_level || 'equipment'] || TAXONOMY_BADGES.equipment;
                                        return sel ? (
                                            <>
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge.color}`}>{badge.label}</span>
                                                <span className="text-sm text-slate-700 font-medium truncate">{sel.tag}</span>
                                                <span className="text-xs text-slate-500 truncate">— {sel.name}</span>
                                            </>
                                        ) : (
                                            <span className="text-sm text-slate-500">Unknown asset</span>
                                        );
                                    })()}
                                    <button
                                        className="ml-auto p-1 text-slate-400 hover:text-red-400 transition-colors"
                                        onClick={() => {
                                            setAssessmentForm(f => ({ ...f, asset_id: '', target_level: '', maintenanceData: null }));
                                            setDataPulled(false);
                                            setShowAssetDropdown(true);
                                        }}
                                    ><X size={14} /></button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        value={assetSearch}
                                        onChange={e => { setAssetSearch(e.target.value); setShowAssetDropdown(true); }}
                                        onFocus={() => setShowAssetDropdown(true)}
                                        placeholder="Search by tag, name, or level (e.g. system, equipment)…"
                                        className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-relantern-500/30"
                                    />
                                </div>
                            )}

                            {/* Dropdown */}
                            {showAssetDropdown && !assessmentForm.asset_id && (
                                <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-50 border border-slate-300 rounded-xl shadow-xl shadow-black/40 max-h-56 overflow-y-auto">
                                    {filteredHierarchyAssets.length === 0 && (
                                        <div className="p-3 text-xs text-slate-400 text-center">No assets found</div>
                                    )}
                                    {filteredHierarchyAssets.map(a => {
                                        const badge = TAXONOMY_BADGES[a.taxonomy_level] || TAXONOMY_BADGES.equipment;
                                        return (
                                            <button
                                                key={a.id}
                                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white transition-colors text-left"
                                                onClick={() => {
                                                    setAssessmentForm(f => ({ ...f, asset_id: a.id, target_level: a.taxonomy_level, maintenanceData: null }));
                                                    setShowAssetDropdown(false);
                                                    setAssetSearch('');
                                                    setDataPulled(false);
                                                }}
                                            >
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badge.color}`}>{badge.label}</span>
                                                <span className="text-sm text-slate-700 font-medium truncate">{a.tag}</span>
                                                <span className="text-xs text-slate-400 truncate">— {a.name}</span>
                                            </button>
                                        );
                                    })}
                                    {filteredHierarchyAssets.length >= 30 && (
                                        <div className="p-2 text-[10px] text-slate-400 text-center border-t border-brand-800">
                                            Showing first 30 — type to narrow search
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── 3. Maintenance Data Section ──────────── */}
                        {assessmentForm.asset_id && (
                            <div className="border border-slate-200 rounded-xl overflow-hidden bg-brand-850">
                                {/* Header */}
                                <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                                    <Database size={14} className="text-accent-cyan" />
                                    <span className="text-xs font-semibold text-slate-700">Maintenance Data</span>
                                    <span className="text-[10px] text-slate-400 ml-auto">Optional — enriches your analysis with historical context</span>
                                </div>

                                {/* Tabs */}
                                <div className="flex border-b border-slate-200">
                                    <button
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${assessmentForm.dataSourceMode === 'connected'
                                            ? 'text-accent-cyan border-b-2 border-accent-cyan bg-accent-cyan/5'
                                            : 'text-slate-500 hover:text-slate-700'}`}
                                        onClick={() => { setAssessmentForm(f => ({ ...f, dataSourceMode: 'connected', maintenanceData: null })); setDataPulled(false); }}
                                    >
                                        <Server size={12} /> Connected Source
                                    </button>
                                    <button
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${assessmentForm.dataSourceMode === 'manual'
                                            ? 'text-accent-cyan border-b-2 border-accent-cyan bg-accent-cyan/5'
                                            : 'text-slate-500 hover:text-slate-700'}`}
                                        onClick={() => { setAssessmentForm(f => ({ ...f, dataSourceMode: 'manual', maintenanceData: null })); setDataPulled(false); }}
                                    >
                                        <Edit3 size={12} /> Manual Input
                                    </button>
                                </div>

                                <div className="p-4 space-y-3">
                                    {/* Connected Source */}
                                    {assessmentForm.dataSourceMode === 'connected' && (
                                        <>
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-medium mb-1 block">Data Source</label>
                                                <select
                                                    value={assessmentForm.selectedConnectorId}
                                                    onChange={e => { setAssessmentForm(f => ({ ...f, selectedConnectorId: e.target.value, maintenanceData: null })); setDataPulled(false); }}
                                                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-accent-cyan"
                                                >
                                                    <option value="local">📂 Local EAM Database</option>
                                                    {runningConnectors.map(c => (
                                                        <option key={c.connector_id} value={c.connector_id}>
                                                            {c.name} ({c.type})
                                                        </option>
                                                    ))}
                                                </select>
                                                {runningConnectors.length === 0 && (
                                                    <p className="text-[10px] text-slate-400 mt-1">No external connectors running. Configure in Admin → Connection Hub.</p>
                                                )}
                                            </div>
                                            <button
                                                onClick={handlePullData}
                                                disabled={dataPulling}
                                                className="w-full py-2 bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/30 text-accent-cyan font-medium rounded-lg text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                            >
                                                {dataPulling ? <><Loader2 size={14} className="animate-spin" /> Pulling Records…</> : <><Database size={14} /> Pull Records</>}
                                            </button>
                                        </>
                                    )}

                                    {/* Manual Input */}
                                    {assessmentForm.dataSourceMode === 'manual' && (
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-medium mb-1 block">Total Work Orders</label>
                                                    <input type="number" min={0} value={manualWOCount} onChange={e => setManualWOCount(e.target.value)}
                                                        placeholder="e.g. 24" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-medium mb-1 block">Failure WOs</label>
                                                    <input type="number" min={0} value={manualFailureCount} onChange={e => setManualFailureCount(e.target.value)}
                                                        placeholder="e.g. 8" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-medium mb-1 block">MTBF (hours)</label>
                                                    <input type="number" min={0} value={manualMTBF} onChange={e => setManualMTBF(e.target.value)}
                                                        placeholder="e.g. 4320" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-medium mb-1 block">MTTR (hours)</label>
                                                    <input type="number" min={0} value={manualMTTR} onChange={e => setManualMTTR(e.target.value)}
                                                        placeholder="e.g. 12" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-medium mb-1 block">Failure Modes (comma-separated)</label>
                                                <input value={manualFailureModes} onChange={e => setManualFailureModes(e.target.value)}
                                                    placeholder="e.g. Bearing Failure, Seal Leakage, Vibration Excess"
                                                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-accent-cyan" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-medium mb-1 block">Notes</label>
                                                <textarea value={manualNotes} onChange={e => setManualNotes(e.target.value)}
                                                    placeholder="Additional context for the analysis team…" rows={2}
                                                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:border-accent-cyan" />
                                            </div>
                                            <button
                                                onClick={handleBuildManualSummary}
                                                disabled={!manualWOCount && !manualFailureModes}
                                                className="w-full py-2 bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/30 text-accent-cyan font-medium rounded-lg text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
                                            >
                                                <CheckCircle size={14} /> Save Manual Data
                                            </button>
                                        </div>
                                    )}

                                    {/* Summary Card */}
                                    {dataPulled && assessmentForm.maintenanceData && (
                                        <div className="border border-accent-cyan/20 rounded-xl bg-accent-cyan/5 p-3 space-y-2 animate-in fade-in-50 duration-300">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle size={14} className="text-accent-safe" />
                                                <span className="text-xs font-semibold text-slate-700">
                                                    {assessmentForm.maintenanceData.source === 'manual' ? 'Manual Data' : `Data from ${assessmentForm.maintenanceData.connectorName}`}
                                                </span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ml-auto ${assessmentForm.maintenanceData.source === 'manual' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'}`}>
                                                    {assessmentForm.maintenanceData.source === 'manual' ? 'MANUAL' : 'CONNECTED'}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-4 gap-2">
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-slate-800">{assessmentForm.maintenanceData.totalWorkOrders}</div>
                                                    <div className="text-[10px] text-slate-400">Total WOs</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-red-400">{assessmentForm.maintenanceData.failureWorkOrders}</div>
                                                    <div className="text-[10px] text-slate-400">Failures</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-slate-800">{assessmentForm.maintenanceData.mtbfHours ?? '—'}</div>
                                                    <div className="text-[10px] text-slate-400">MTBF (hrs)</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="text-lg font-bold text-slate-800">{assessmentForm.maintenanceData.mttrHours ?? '—'}</div>
                                                    <div className="text-[10px] text-slate-400">MTTR (hrs)</div>
                                                </div>
                                            </div>
                                            {assessmentForm.maintenanceData.topFailureModes.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {assessmentForm.maintenanceData.topFailureModes.slice(0, 5).map((fm, i) => (
                                                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                                                            {fm.mode} <span className="text-slate-400">×{fm.count}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {assessmentForm.maintenanceData.lastWODate && (
                                                <div className="text-[10px] text-slate-400">
                                                    Last WO: {new Date(assessmentForm.maintenanceData.lastWODate).toLocaleDateString()}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── 4. Description ──────────────────────── */}
                        <div>
                            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Problem Statement / Description</label>
                            <textarea
                                value={assessmentForm.description}
                                onChange={e => setAssessmentForm(f => ({ ...f, description: e.target.value }))}
                                placeholder="Describe the failure event or scope of analysis…"
                                rows={3}
                                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-relantern-500/30"
                            />
                        </div>

                        {/* ── Create Button ────────────────────────── */}
                        <button
                            onClick={handleCreateAssessment}
                            disabled={!assessmentForm.title || !assessmentForm.asset_id}
                            className="w-full py-3 bg-accent-cyan hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-brand-900 font-bold rounded-xl text-sm transition-colors shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                        >
                            Create Analysis
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NewAssessmentModal;
