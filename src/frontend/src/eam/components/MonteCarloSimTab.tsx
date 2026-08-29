import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Search, AlertTriangle, Loader2, Info, ChevronDown, ChevronUp,
    Dices, Play, RotateCcw, Upload, Cpu, Database, FileText, Settings, Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
    runMonteCarloSimulation, fitWeibullFromTTFs, fitLognormalFromRepairs,
    parseCSVData, generateCSVTemplate,
    type MCInputs, type MCOutput
} from '../utils/monteCarloEngine';
import { MonteCarloResults } from '../components/MonteCarloResults';
import { CreatePMFromWeibullModal, type WeibullPMData } from '../../components/analyze/CreatePMFromWeibullModal';
import {
    FAILURE_QUERY_COLUMNS, isFailure, failureIntervalsHours, failureRepairHours,
} from '../services/reliabilityMetrics';

interface AssetOption { id: string; name: string; tag: string; criticality: string; }

// ─── Data Quality Badge ──────────────────────────────────────
const DataQualityBadge = ({ failures, repairs }: { failures: number; repairs: number }) => {
    if (failures >= 10 && repairs >= 5)
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-full border border-emerald-200">🟢 Strong — {failures} failures, {repairs} repairs</span>;
    if (failures >= 3)
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-bold rounded-full border border-amber-200">🟡 Fair — {failures} failures (low confidence)</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 text-[11px] font-bold rounded-full border border-red-200">🔴 Insufficient — {failures} failures (manual entry needed)</span>;
};

// ─── Asset Selector (inline) ─────────────────────────────────
function MCAssetSelector({ onSelect }: { onSelect: (a: AssetOption | null) => void }) {
    const [query, setQuery] = useState('');
    const [assets, setAssets] = useState<AssetOption[]>([]);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<AssetOption | null>(null);

    useEffect(() => {
        supabase.from('assets').select('id, name, tag, criticality')
            .order('name').limit(200)
            .then(({ data }) => setAssets(data || []));
    }, []);

    const filtered = query
        ? assets.filter(a => a.name?.toLowerCase().includes(query.toLowerCase()) || a.tag?.toLowerCase().includes(query.toLowerCase()))
        : assets;

    return (
        <div className="relative">
            <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white cursor-pointer" onClick={() => setOpen(!open)}>
                <Search size={14} className="text-slate-400" />
                <input type="text"
                    value={open ? query : selected ? `${selected.name} (${selected.tag || 'No Tag'})` : ''}
                    onChange={e => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    placeholder="Search asset by name or tag..."
                    className="w-full text-sm outline-none bg-transparent" />
                {selected && (
                    <button onClick={e => { e.stopPropagation(); setSelected(null); onSelect(null); setQuery(''); }}
                        className="text-slate-400 hover:text-red-500">✕</button>
                )}
            </div>
            {open && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {filtered.slice(0, 20).map(a => (
                        <button key={a.id} onClick={() => { setSelected(a); onSelect(a); setOpen(false); setQuery(''); }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between">
                            <span>{a.name}</span>
                            <span className="text-xs text-slate-400 font-mono">{a.tag}</span>
                        </button>
                    ))}
                    {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No assets found</p>}
                </div>
            )}
        </div>
    );
}

// ═════════════════════════════════════════════════════════════
//  MONTE CARLO SIMULATION TAB
// ═════════════════════════════════════════════════════════════
export interface MCTabProps {
    onStateChange?: (inputs: Record<string, any>, results: Record<string, any>, asset?: any) => void;
    loadedData?: { inputs: Record<string, any>; results: Record<string, any> } | null;
    bridgeData?: { beta: number; eta: number; r2?: number; dataStr?: string } | null;
    onSendToRAM?: (mtbf: number, mttr: number, ao: number) => void;
    /** Fired after a PM program is created from this simulation — lets the parent stamp linked_pm_id on the saved study. */
    onPMCreated?: (pmId: string, pmTitle: string) => void;
}

export function MonteCarloSimTab({ onStateChange, loadedData, bridgeData, onSendToRAM, onPMCreated }: MCTabProps) {
    // ─── Inputs (default blank until Weibull bridge or EAM spool populates) ──
    const [beta, setBeta] = useState(bridgeData?.beta ?? 0);
    const [eta, setEta] = useState(bridgeData?.eta ?? 0);
    const [muR, setMuR] = useState(2.3);
    const [sigmaR, setSigmaR] = useState(0.6);
    const [missionTime, setMissionTime] = useState(8760);
    const [numRuns, setNumRuns] = useState(10000);
    const [costPerFailure, setCostPerFailure] = useState(15000);
    const [pmCost, setPmCost] = useState(3500);
    const [pmInterval, setPmInterval] = useState(0);
    const [pmDuration, setPmDuration] = useState(8);
    const [bridgeApplied, setBridgeApplied] = useState(false);
    // Fit quality of whatever produced β/η (bridge, spool, or CSV) — carried into the PM provenance.
    const [fitR2, setFitR2] = useState(0);

    // ─── State ───────────────────────────────────────────────
    const [output, setOutput] = useState<MCOutput | null>(null);
    const [running, setRunning] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [pasteData, setPasteData] = useState('');
    const [spoolStatus, setSpoolStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
    const [spoolInfo, setSpoolInfo] = useState<{ failures: number; repairs: number } | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
    const [showPMModal, setShowPMModal] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // ─── Load bridge data from Weibull tab ───────────────────
    const lastBridgeRef = useRef<string | null>(null);
    useEffect(() => {
        if (bridgeData) {
            const key = `${bridgeData.beta}-${bridgeData.eta}`;
            if (lastBridgeRef.current !== key) {
                setBeta(bridgeData.beta);
                setEta(bridgeData.eta);
                setFitR2(bridgeData.r2 ?? 0);
                // Auto-set PM interval at 80% of η for wear-out (β > 1)
                if (bridgeData.beta > 1 && bridgeData.eta > 0) {
                    setPmInterval(Math.round(bridgeData.eta * 0.8));
                }
                lastBridgeRef.current = key;
                setBridgeApplied(true);
            }
        }
    }, [bridgeData]);

    // ─── Load saved state ────────────────────────────────────
    useEffect(() => {
        if (loadedData?.inputs) {
            const i = loadedData.inputs;
            if (i.beta) setBeta(i.beta);
            if (i.eta) setEta(i.eta);
            if (i.muR) setMuR(i.muR);
            if (i.sigmaR) setSigmaR(i.sigmaR);
            if (i.missionTime) setMissionTime(i.missionTime);
            if (i.numRuns) setNumRuns(i.numRuns);
            if (i.costPerFailure) setCostPerFailure(i.costPerFailure);
            if (i.pmCost) setPmCost(i.pmCost);
            if (i.pmInterval) setPmInterval(i.pmInterval);
            if (i.pmDuration) setPmDuration(i.pmDuration);
        }
    }, [loadedData]);

    // ─── EAM Data Spool ──────────────────────────────────────
    const handleAssetSelect = useCallback(async (asset: AssetOption | null) => {
        setSelectedAsset(asset);
        if (!asset) { setSpoolStatus('idle'); setSpoolInfo(null); return; }

        setSpoolStatus('loading');
        try {
            // Same engine basis as the Weibull tab / Metrics scoreboard: fetch
            // ALL types and let isFailure classify. The previous hand-rolled
            // select (actual_hours/actual_cost/wo_type) named columns that
            // don't exist on work_orders — PostgREST rejected the whole select
            // (42703) and the spool silently returned nothing.
            const { data: wos } = await supabase.from('work_orders')
                .select(`${FAILURE_QUERY_COLUMNS}, total_actual_cost, frozen_labor_cost, frozen_material_cost`)
                .eq('asset_id', asset.id)
                .order('created_at', { ascending: true });

            const records = wos || [];
            const failures = records.filter(isFailure);

            // TTF intervals + repair times from the shared engine (primaries only).
            const ttfs = failureIntervalsHours(records);
            const repairs = failureRepairHours(records);

            // Cost per failure event, frozen figures first.
            const costs = failures
                .map((w: any) => Number(w.frozen_labor_cost ?? 0) + Number(w.frozen_material_cost ?? 0) || Number(w.total_actual_cost ?? 0))
                .filter(c => c > 0);

            setSpoolInfo({ failures: ttfs.length, repairs: repairs.length });

            // Auto-fit Weibull if enough data
            if (ttfs.length >= 2) {
                const wFit = fitWeibullFromTTFs(ttfs);
                if (wFit) { setBeta(wFit.beta); setEta(wFit.eta); setFitR2(wFit.r2); }
            }
            // Auto-fit Lognormal if enough repair data
            if (repairs.length >= 2) {
                const lFit = fitLognormalFromRepairs(repairs);
                if (lFit) { setMuR(lFit.mu); setSigmaR(lFit.sigma); }
            }
            // Average cost
            if (costs.length > 0) {
                setCostPerFailure(Math.round(costs.reduce((s, c) => s + c, 0) / costs.length));
            }

            setSpoolStatus('done');
        } catch (err) {
            console.error('Spool error:', err);
            setSpoolStatus('error');
        }
    }, []);

    // ─── CSV Import ──────────────────────────────────────────
    const handleCSVImport = useCallback((text: string) => {
        const { ttfs, repairs, costs } = parseCSVData(text);
        if (ttfs.length >= 2) {
            const wFit = fitWeibullFromTTFs(ttfs);
            if (wFit) { setBeta(wFit.beta); setEta(wFit.eta); setFitR2(wFit.r2); }
        }
        if (repairs.length >= 2) {
            const lFit = fitLognormalFromRepairs(repairs);
            if (lFit) { setMuR(lFit.mu); setSigmaR(lFit.sigma); }
        }
        if (costs.length > 0) setCostPerFailure(Math.round(costs.reduce((s, c) => s + c, 0) / costs.length));
        setSpoolInfo({ failures: ttfs.length, repairs: repairs.length });
    }, []);

    const handleFileDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) file.text().then(handleCSVImport);
    }, [handleCSVImport]);

    // ─── Run Simulation ──────────────────────────────────────
    const runSimulation = useCallback(() => {
        setRunning(true);
        // Use setTimeout to let React render the loading state
        setTimeout(() => {
            const inputs: MCInputs = { beta, eta, muR, sigmaR, missionTime, numRuns, costPerFailure, pmCost, pmInterval, pmDuration };
            const result = runMonteCarloSimulation(inputs);
            setOutput(result);
            setRunning(false);
            if (onStateChange) {
                onStateChange(inputs, {
                    ao_p50: result.rtfPercentiles.ao.p50,
                    failures_p50: result.rtfPercentiles.failures.p50,
                    cost_p50: result.rtfPercentiles.cost.p50,
                    mtbf_sim: result.rtfPercentiles.mtbfSim,
                    converged: result.converged,
                }, selectedAsset ? { id: selectedAsset.id, tag: selectedAsset.tag, name: selectedAsset.name } : null);
            }
        }, 50);
    }, [beta, eta, muR, sigmaR, missionTime, numRuns, costPerFailure, pmCost, pmInterval, pmDuration, onStateChange, selectedAsset]);

    const resetAll = () => {
        // Reset to bridge values if available, otherwise zero
        setBeta(bridgeData?.beta ?? 0); setEta(bridgeData?.eta ?? 0);
        setMuR(2.3); setSigmaR(0.6);
        setMissionTime(8760); setNumRuns(10000); setCostPerFailure(15000);
        setPmCost(3500);
        setPmInterval(bridgeData && bridgeData.beta > 1 ? Math.round(bridgeData.eta * 0.8) : 0);
        setPmDuration(8);
        setOutput(null); setSpoolInfo(null); setSpoolStatus('idle');
        setBridgeApplied(!!bridgeData);
    };

    const downloadTemplate = () => {
        const csv = generateCSVTemplate();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'monte_carlo_template.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    // ─── Input field helper ──────────────────────────────────
    const Field = ({ label, value, onChange, unit, tip }: {
        label: string; value: number; onChange: (v: number) => void; unit?: string; tip?: string;
    }) => (
        <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                {label} {unit && <span className="font-normal text-slate-400">({unit})</span>}
                {tip && <span title={tip} className="cursor-help"><Info size={10} className="text-slate-300" /></span>}
            </label>
            <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
                className="w-full mt-0.5 px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none h-9" />
        </div>
    );

    // ─── Weibull regime interpretation ───────────────────────
    const regime = beta < 1 ? 'Infant Mortality (β<1)' : beta === 1 ? 'Random (β=1)' : 'Wear-out (β>1)';
    const regimeColor = beta < 1 ? 'text-orange-600' : beta > 1 ? 'text-blue-600' : 'text-slate-500';

    return (
        <div className="space-y-4">
            {/* ═══ HEADER ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg text-white shadow-md">
                        <Dices size={16} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900">Monte Carlo Simulation</h3>
                        <p className="text-[10px] text-slate-500">Probabilistic lifecycle · Weibull TTF + Lognormal TTR · ISO 14224</p>
                    </div>
                </div>
            </div>

            {/* ═══ DATA PROVENANCE INDICATOR ═══ */}
            {bridgeApplied && bridgeData ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-emerald-800">
                            ✓ Failure model populated from Weibull Analysis
                        </p>
                        <p className="text-[10px] text-emerald-600">
                            β = {bridgeData.beta} · η = {bridgeData.eta} hrs — derived from your failure intervals.
                            {bridgeData.beta > 1 && ` PM interval auto-set to ${Math.round(bridgeData.eta * 0.8)} hrs (80% of η).`}
                        </p>
                    </div>
                </div>
            ) : beta === 0 && eta === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2.5">
                    <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-amber-800">
                            No failure model configured
                        </p>
                        <p className="text-[10px] text-amber-600">
                            Run Weibull Analysis first to auto-populate β and η, or select an asset below, or enter values manually.
                        </p>
                    </div>
                </div>
            ) : null}

            {/* ═══ DATA SOURCE: EAM SPOOL ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Database size={14} className="text-blue-500" /> Auto-Populate from EAM Work Orders
                </h4>
                <MCAssetSelector onSelect={handleAssetSelect} />
                {spoolStatus === 'loading' && (
                    <div className="flex items-center gap-2 text-sm text-blue-500">
                        <Loader2 size={14} className="animate-spin" /> Spooling maintenance history...
                    </div>
                )}
                {spoolStatus === 'done' && spoolInfo && <DataQualityBadge failures={spoolInfo.failures} repairs={spoolInfo.repairs} />}
                {spoolStatus === 'error' && <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12} /> Failed to fetch work order data</p>}
            </div>

            {/* ═══ DATA SOURCE: CSV IMPORT ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button onClick={() => setShowImport(!showImport)}
                    className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                    <span className="flex items-center gap-1.5"><Upload size={14} className="text-blue-500" /> Import External Data (CSV)</span>
                    {showImport ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showImport && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
                        <p className="text-[11px] text-slate-500 pt-3">
                            Paste or drop a CSV with columns: <code className="bg-slate-100 px-1 rounded">failure_time_hours, repair_time_hours, cost_usd</code>
                        </p>
                        <div onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}
                            className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-blue-300 transition-colors">
                            <textarea value={pasteData} onChange={e => setPasteData(e.target.value)}
                                placeholder="Paste data here (comma, tab, or newline separated)..."
                                className="w-full h-20 text-xs font-mono outline-none resize-none bg-transparent" />
                            <p className="text-[10px] text-slate-400 mt-1">Or drag & drop a .csv file</p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { if (pasteData.trim()) handleCSVImport(pasteData); }}
                                disabled={!pasteData.trim()}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-primary-500 disabled:opacity-40">
                                Parse & Apply
                            </button>
                            <button onClick={downloadTemplate}
                                className="px-3 py-1.5 border border-slate-300 text-slate-600 text-xs rounded-lg hover:bg-slate-50">
                                📥 Download Template
                            </button>
                            <input ref={fileRef} type="file" accept=".csv" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(handleCSVImport); }} />
                            <button onClick={() => fileRef.current?.click()}
                                className="px-3 py-1.5 border border-slate-300 text-slate-600 text-xs rounded-lg hover:bg-slate-50">
                                📁 Browse File
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ═══ SIMULATION PARAMETERS ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                    <Settings size={14} className="text-slate-500" /> Simulation Parameters
                </h4>

                {/* Failure + Repair Model */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-3">
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <Zap size={12} className="text-red-500" /> Failure Model (Weibull)
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="β Shape" value={beta} onChange={setBeta} tip="β<1: infant mortality, β=1: random, β>1: wear-out" />
                            <Field label="η Scale" value={eta} onChange={setEta} unit="hrs" tip="Characteristic life (63.2% fail by this time)" />
                        </div>
                        <p className={`text-[10px] font-bold ${regimeColor}`}>◉ {regime}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-3">
                        <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <FileText size={12} className="text-blue-500" /> Repair Model (Lognormal)
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="μ_log Mean" value={muR} onChange={setMuR} tip="Log-space mean of repair times" />
                            <Field label="σ_log Std" value={sigmaR} onChange={setSigmaR} tip="Log-space std deviation of repair times" />
                        </div>
                        <p className="text-[10px] text-slate-500">
                            Derived MTTR ≈ {Math.round(Math.exp(muR + (sigmaR ** 2) / 2) * 10) / 10} hrs
                        </p>
                    </div>
                </div>

                {/* Simulation Config */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="Mission Time" value={missionTime} onChange={setMissionTime} unit="hrs" />
                    <Field label="Simulation Runs" value={numRuns} onChange={setNumRuns} />
                    <Field label="Cost / Failure" value={costPerFailure} onChange={setCostPerFailure} unit="$" />
                    <Field label="PM Cost" value={pmCost} onChange={setPmCost} unit="$" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field label="PM Interval" value={pmInterval} onChange={setPmInterval} unit="hrs" tip="Set to 0 to disable PM (RTF only)" />
                    <Field label="PM Duration" value={pmDuration} onChange={setPmDuration} unit="hrs" />
                </div>
            </div>

            {/* ═══ RUN CONTROLS ═══ */}
            <div className="flex items-center flex-wrap gap-2">
                <button onClick={runSimulation} disabled={running || beta <= 0 || eta <= 0}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl disabled:opacity-50 transition-all text-sm">
                    {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run</>}
                </button>
                <button onClick={resetAll}
                    className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 text-xs">
                    <RotateCcw size={12} /> Reset
                </button>
                <span className="ml-auto text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <Cpu size={10} /> {numRuns.toLocaleString()} × {pmInterval > 0 ? '2' : '1'} strategy
                </span>
            </div>

            {/* ═══ RESULTS ═══ */}
            {output && (
                <>
                    <MonteCarloResults
                        output={output}
                        hasPM={pmInterval > 0}
                        onSendToRAM={onSendToRAM}
                        onCreatePM={selectedAsset && beta > 1 ? () => setShowPMModal(true) : undefined}
                        asset={selectedAsset ? { id: selectedAsset.id, tag: selectedAsset.tag, name: selectedAsset.name } : null}
                        pmInterval={pmInterval}
                        beta={beta}
                        eta={eta}
                    />

                    {/* PM Creation Modal */}
                    {selectedAsset && beta > 0 && eta > 0 && (
                        <CreatePMFromWeibullModal
                            isOpen={showPMModal}
                            onClose={() => setShowPMModal(false)}
                            onSuccess={(pmId, pmTitle) => { if (pmId) onPMCreated?.(pmId, pmTitle || 'PM program'); }}
                            data={{
                                asset: { id: selectedAsset.id, tag: selectedAsset.tag, name: selectedAsset.name },
                                beta,
                                eta,
                                r2: fitR2,
                                b10: Math.round(eta * Math.pow(-Math.log(0.9), 1 / beta)),
                                pmInterval: pmInterval > 0 ? pmInterval : Math.round(eta * 0.8),
                                dataPoints: output.rtfRuns.length,
                            }}
                        />
                    )}
                </>
            )}

            {/* ═══ EMPTY STATE ═══ */}
            {!output && !running && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
                    <Dices size={40} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-500">Configure parameters above and run simulation</p>
                    <p className="text-xs text-slate-400 mt-1">
                        Auto-populate from EAM work orders, import CSV data, or enter parameters manually.
                        <br />The engine uses Weibull failure generation (inverse CDF) with Lognormal repair times.
                    </p>
                </div>
            )}
        </div>
    );
}

export default MonteCarloSimTab;
