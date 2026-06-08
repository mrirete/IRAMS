import React, { useState, useEffect } from 'react';
import {
    Gauge, ArrowRight, Plus, Trash2, TrendingUp, TrendingDown,
    Activity, Play, Sparkles, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw
} from 'lucide-react';

interface OEEInput {
    assetName: string;
    plannedTime: number; // hours
    downtime: number; // hours
    idealRate: number; // units/hour
    totalProduced: number;
    goodProduced: number;
}

interface OEEResult {
    id: string;
    assetName: string;
    availability: number;
    performance: number;
    rawPerformance: number;
    quality: number;
    oee: number;
    uptime: number;
    scrap: number;
    plannedTime: number;
    downtime: number;
    totalProduced: number;
    goodProduced: number;
    idealRate: number;
    availabilityLossHours: number;
    performanceLossHours: number;
    qualityLossHours: number;
    netProductiveHours: number;
    timestamp: string;
}

const DEFAULT_INPUTS: OEEInput[] = [
    {
        assetName: 'Main Gas Compressor (CMP-201)',
        plannedTime: 24,
        downtime: 2.5,
        idealRate: 500, // standard capacity units/hr
        totalProduced: 10200,
        goodProduced: 9950
    },
    {
        assetName: 'Boiler Feed Pump B (PMP-411)',
        plannedTime: 168, // 1 week
        downtime: 18.0,
        idealRate: 120,
        totalProduced: 17200,
        goodProduced: 16800
    },
    {
        assetName: 'Overhead Condenser (HEX-902)',
        plannedTime: 24,
        downtime: 0,
        idealRate: 800,
        totalProduced: 20400, // over-speed case!
        goodProduced: 20100
    }
];

export const OEETab: React.FC<{
    contextAsset?: any;
    onRcaInitiate?: (assetName: string, oeeScore: number) => void;
}> = ({ contextAsset, onRcaInitiate }) => {
    // Current Calculator Inputs
    const [inputs, setInputs] = useState<OEEInput>({
        assetName: contextAsset?.name || 'Main Gas Compressor (CMP-201)',
        plannedTime: 24,
        downtime: 2.2,
        idealRate: 450,
        totalProduced: 9100,
        goodProduced: 8850
    });

    // History log of runs
    const [history, setHistory] = useState<OEEResult[]>([]);
    const [activeResult, setActiveResult] = useState<OEEResult | null>(null);
    const [activeTab, setActiveTab] = useState<'calculator' | 'compare' | 'history'>('calculator');
    const [aiAdvisory, setAiAdvisory] = useState<string | null>(null);
    const [isAiLoading, setIsAiLoading] = useState(false);

    // Sync asset context
    useEffect(() => {
        if (contextAsset) {
            setInputs(prev => ({
                ...prev,
                assetName: `${contextAsset.name} (${contextAsset.tag || 'N/A'})`
            }));
        }
    }, [contextAsset]);

    // Load initial local storage history or seed default runs
    useEffect(() => {
        const stored = localStorage.getItem('ers_oee_history');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setHistory(parsed);
                if (parsed.length > 0) setActiveResult(parsed[0]);
            } catch (e) {
                console.error(e);
            }
        } else {
            // Seed defaults
            const seeded = DEFAULT_INPUTS.map(inp => calculateOEELocal(inp));
            setHistory(seeded);
            setActiveResult(seeded[0]);
            localStorage.setItem('ers_oee_history', JSON.stringify(seeded));
        }
    }, []);

    const calculateOEELocal = (inp: OEEInput): OEEResult => {
        const { assetName, plannedTime, downtime, idealRate, totalProduced, goodProduced } = inp;

        const uptime = Math.max(0, plannedTime - downtime);
        const scrap = Math.max(0, totalProduced - goodProduced);

        let availability = 0;
        if (plannedTime > 0) {
            availability = Math.min(1.0, Math.max(0, uptime / plannedTime));
        }

        let rawPerformance = 0;
        if (idealRate > 0 && uptime > 0) {
            rawPerformance = totalProduced / (idealRate * uptime);
        }
        const performance = Math.min(1.0, Math.max(0, rawPerformance));

        let quality = 1.0;
        if (totalProduced > 0) {
            quality = Math.min(1.0, Math.max(0, goodProduced / totalProduced));
        }

        const oee = availability * performance * quality;

        const availabilityLossHours = downtime;
        const performanceLossHours = Math.max(0, uptime - (totalProduced / idealRate));
        const qualityLossHours = totalProduced > 0 && idealRate > 0 ? (scrap / idealRate) : 0;
        const netProductiveHours = Math.max(0, plannedTime * oee);

        return {
            id: Math.random().toString(36).substr(2, 9),
            assetName,
            availability,
            performance,
            rawPerformance,
            quality,
            oee,
            uptime,
            scrap,
            plannedTime,
            downtime,
            totalProduced,
            goodProduced,
            idealRate,
            availabilityLossHours,
            performanceLossHours,
            qualityLossHours,
            netProductiveHours,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString()
        };
    };

    const handleCalculate = (e: React.FormEvent) => {
        e.preventDefault();
        const result = calculateOEELocal(inputs);
        setActiveResult(result);

        const newHistory = [result, ...history.filter(h => h.assetName !== result.assetName || h.timestamp !== result.timestamp)].slice(0, 15);
        setHistory(newHistory);
        localStorage.setItem('ers_oee_history', JSON.stringify(newHistory));
        setAiAdvisory(null);
    };

    const handleDeleteHistory = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newHistory = history.filter(h => h.id !== id);
        setHistory(newHistory);
        localStorage.setItem('ers_oee_history', JSON.stringify(newHistory));
        if (activeResult?.id === id) {
            setActiveResult(newHistory.length > 0 ? newHistory[0] : null);
        }
    };

    const handleLoadInput = (record: OEEResult) => {
        setInputs({
            assetName: record.assetName,
            plannedTime: record.plannedTime,
            downtime: record.downtime,
            idealRate: record.idealRate,
            totalProduced: record.totalProduced,
            goodProduced: record.goodProduced
        });
        setActiveResult(record);
        setActiveTab('calculator');
        setAiAdvisory(null);
    };

    // Calculate OEE color classes
    const getMetricColor = (val: number) => {
        if (val >= 0.85) return { text: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200', circle: 'stroke-emerald-500' };
        if (val >= 0.70) return { text: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', circle: 'stroke-amber-500' };
        return { text: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', circle: 'stroke-red-500' };
    };

    const generateAIAdvice = () => {
        if (!activeResult) return;
        setIsAiLoading(true);

        // Deterministic expert advice simulation based on biggest loss component
        setTimeout(() => {
            const availLoss = activeResult.availabilityLossHours;
            const perfLoss = activeResult.performanceLossHours;
            const qualLoss = activeResult.qualityLossHours;
            const maxLoss = Math.max(availLoss, perfLoss, qualLoss);

            let biggestFactor = 'Availability';
            let rootCauseIdea = '';
            let strategyRecommendation = '';

            if (maxLoss === availLoss) {
                biggestFactor = 'Availability (Downtime)';
                rootCauseIdea = 'Chronic equipment downtime issues. This is usually driven by mechanical failures, delayed maintenance response, or supply-chain lags for critical spares.';
                strategyRecommendation = '1. **RCA Priority**: Trigger a 5-Why investigation on recent breakdown events.\n2. **PM Optimization**: Shift from reactive run-to-failure to scheduled condition monitoring (e.g. vibration analysis for rotating assets).\n3. **Criticality Check**: Ensure this asset is registered as Criticality A with a locked spare-parts min/max policy.';
            } else if (maxLoss === perfLoss) {
                biggestFactor = 'Performance (Speed Losses)';
                rootCauseIdea = 'Sub-optimal running capacity. This indicates equipment wear (clogging, bearing degradation, steam leakage), operator speed throttling, or feed-quality deviations.';
                strategyRecommendation = '1. **Calibration Audit**: Validate if design flow/capacity rates align with current operational tolerances.\n2. **Degradation Scanning**: Run digital twin sensors to isolate flow friction or temperature anomalies.\n3. **SOP Standard**: Audit shift handovers to eliminate manual throttling behaviors by operators.';
            } else {
                biggestFactor = 'Quality (Product Rejects)';
                rootCauseIdea = 'High product defects/rejects. Process instabilities, startup/shutdown scrap cycles, fluid contamination, or calibration drift in secondary components are the key contributors.';
                strategyRecommendation = '1. **FMEA Update**: Re-evaluate the RPN for component failure modes associated with fluid quality.\n2. **Instrument Tuning**: Calibrate downstream control valves and pressure transmitter loops.\n3. **Management of Change (MoC)**: Audit chemical or material feed specs changed in the last 90 days.';
            }

            const mockAdvice = `### ERS Reliability Specialist — OEE Advisory Report
**Asset**: ${activeResult.assetName}
**Overall OEE**: ${(activeResult.oee * 100).toFixed(1)}% | **Status**: ${activeResult.oee >= 0.85 ? 'World Class' : activeResult.oee >= 0.75 ? 'Healthy' : 'Investigate Required'}

#### 🔍 Loss Analysis
Your primary OEE constraint is **${biggestFactor}**, accounting for **${maxLoss.toFixed(1)} hours** of equivalent capacity losses.

* **Availability**: ${(activeResult.availability * 100).toFixed(1)}% (Loss: ${activeResult.availabilityLossHours.toFixed(1)} hrs)
* **Performance**: ${(activeResult.performance * 100).toFixed(1)}% ${activeResult.rawPerformance > 1.0 ? `(Uncapped: ${(activeResult.rawPerformance * 100).toFixed(0)}%)` : ''} (Loss: ${activeResult.performanceLossHours.toFixed(1)} hrs)
* **Quality**: ${(activeResult.quality * 100).toFixed(1)}% (Loss: ${activeResult.qualityLossHours.toFixed(1)} hrs)

#### ⚙️ Engineering Assessment
${rootCauseIdea}

#### 📋 Recommended Defect Elimination Strategy
${strategyRecommendation}

> [!NOTE]
> *This report was generated using ISO 55000 reliability diagnostics and standard loss-accounting formulas.*`;

            setAiAdvisory(mockAdvice);
            setIsAiLoading(false);
        }, 800);
    };

    return (
        <div className="space-y-6">
            {/* ── Tabs Header ───────────────────────────────── */}
            <div className="flex justify-between items-center bg-slate-50 p-1.5 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="flex gap-1">
                    <button
                        onClick={() => setActiveTab('calculator')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'calculator' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        <Gauge size={14} /> OEE Calculator & Losses
                    </button>
                    <button
                        onClick={() => setActiveTab('compare')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'compare' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        <Activity size={14} /> Compare & Rank Assets
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'history' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        <TrendingUp size={14} /> Historical Trends ({history.length})
                    </button>
                </div>
                <div className="text-[10px] text-slate-400 font-medium px-2 hidden sm:block">ISO 55000 Diagnostics Module</div>
            </div>

            {/* ── TAB 1: CALCULATOR ──────────────────────────── */}
            {activeTab === 'calculator' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left: Input Form (1/3) */}
                    <div className="lg:col-span-1 bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 pb-2 border-b border-slate-100">
                            <Gauge size={16} className="text-indigo-600" /> Enter Asset Parameters
                        </div>
                        <form onSubmit={handleCalculate} className="space-y-3.5">
                            <div>
                                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Asset Reference</label>
                                <input
                                    type="text"
                                    required
                                    value={inputs.assetName}
                                    onChange={e => setInputs({ ...inputs, assetName: e.target.value })}
                                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                    placeholder="e.g. Pump, Compressor, Turbine..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Planned Production (hrs)</label>
                                    <input
                                        type="number"
                                        required
                                        min="0.1"
                                        step="any"
                                        value={inputs.plannedTime}
                                        onChange={e => setInputs({ ...inputs, plannedTime: parseFloat(e.target.value) || 0 })}
                                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Total Downtime (hrs)</label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        step="any"
                                        value={inputs.downtime}
                                        onChange={e => setInputs({ ...inputs, downtime: parseFloat(e.target.value) || 0 })}
                                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Ideal Production Rate (units/hr)</label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={inputs.idealRate}
                                    onChange={e => setInputs({ ...inputs, idealRate: parseInt(e.target.value) || 0 })}
                                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Total Produced (units)</label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        value={inputs.totalProduced}
                                        onChange={e => setInputs({ ...inputs, totalProduced: parseInt(e.target.value) || 0 })}
                                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Good Produced (units)</label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        value={inputs.goodProduced}
                                        onChange={e => setInputs({ ...inputs, goodProduced: parseInt(e.target.value) || 0 })}
                                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 font-semibold text-slate-700 focus:outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full flex items-center justify-center gap-2 mt-4 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-xl text-xs transition-all shadow-md hover:shadow-lg"
                            >
                                <Play size={12} fill="currentColor" /> Run OEE Calculation
                            </button>
                        </form>

                        <div className="pt-3 border-t border-slate-100 space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Standard Templates</span>
                            <div className="space-y-1.5">
                                {DEFAULT_INPUTS.map((def, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                            setInputs(def);
                                            setActiveResult(calculateOEELocal(def));
                                            setAiAdvisory(null);
                                        }}
                                        className="w-full text-left p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[11px] font-semibold text-slate-600 transition-colors truncate"
                                    >
                                        🚀 {def.assetName} ({def.plannedTime}h @ {def.idealRate}/h)
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right: Results Dashboard (2/3) */}
                    <div className="lg:col-span-2 space-y-6">
                        {activeResult ? (
                            <>
                                {/* Overall OEE Dials Grid */}
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
                                        <div>
                                            <h3 className="font-bold text-slate-800 text-base">{activeResult.assetName}</h3>
                                            <span className="text-[10px] text-slate-400 font-semibold uppercase">OEE Snapshot Run at {activeResult.timestamp}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={generateAIAdvice}
                                                disabled={isAiLoading}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-lg text-[10px] sm:text-xs transition-all shadow-sm hover:shadow"
                                            >
                                                {isAiLoading ? (
                                                    <RefreshCw size={12} className="animate-spin" />
                                                ) : (
                                                    <Sparkles size={12} />
                                                )}
                                                Reliability Advisor AI
                                            </button>
                                            {activeResult.oee < 0.80 && onRcaInitiate && (
                                                <button
                                                    onClick={() => onRcaInitiate(activeResult.assetName, activeResult.oee)}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-[10px] sm:text-xs transition-all shadow-sm"
                                                >
                                                    <AlertTriangle size={12} /> Initiate RCA Study
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Circle Gauges Row */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center pb-6 border-b border-slate-100">
                                        {/* Dial 1: Overall OEE */}
                                        <div className="text-center space-y-2">
                                            <div className="relative w-28 h-28 flex items-center justify-center">
                                                <svg className="w-full h-full transform -rotate-90">
                                                    <circle cx="56" cy="56" r="48" stroke="#f1f5f9" strokeWidth="8" fill="transparent" />
                                                    <circle
                                                        cx="56" cy="56" r="48"
                                                        stroke="url(#oeeGrad)" strokeWidth="9" fill="transparent"
                                                        strokeDasharray={2 * Math.PI * 48}
                                                        strokeDashoffset={2 * Math.PI * 48 * (1 - activeResult.oee)}
                                                        strokeLinecap="round"
                                                        className="transition-all duration-1000 ease-out"
                                                    />
                                                    <defs>
                                                        <linearGradient id="oeeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                                            <stop offset="0%" stopColor="#4f46e5" />
                                                            <stop offset="100%" stopColor="#c084fc" />
                                                        </linearGradient>
                                                    </defs>
                                                </svg>
                                                <div className="absolute flex flex-col items-center">
                                                    <span className="text-2xl font-black text-slate-800 font-mono">{(activeResult.oee * 100).toFixed(0)}%</span>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">OEE Score</span>
                                                </div>
                                            </div>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getMetricColor(activeResult.oee).bg} ${getMetricColor(activeResult.oee).text} border ${getMetricColor(activeResult.oee).border}`}>
                                                {activeResult.oee >= 0.85 ? 'World Class' : activeResult.oee >= 0.70 ? 'Acceptable' : 'Sub-Optimal'}
                                            </span>
                                        </div>

                                        {/* Dial 2: Availability */}
                                        <div className="text-center space-y-2">
                                            <div className="relative w-24 h-24 flex items-center justify-center">
                                                <svg className="w-full h-full transform -rotate-90">
                                                    <circle cx="48" cy="48" r="40" stroke="#f1f5f9" strokeWidth="6" fill="transparent" />
                                                    <circle
                                                        cx="48" cy="48" r="40"
                                                        stroke="#3b82f6" strokeWidth="7" fill="transparent"
                                                        strokeDasharray={2 * Math.PI * 40}
                                                        strokeDashoffset={2 * Math.PI * 40 * (1 - activeResult.availability)}
                                                        strokeLinecap="round"
                                                        className="transition-all duration-1000 ease-out"
                                                    />
                                                </svg>
                                                <div className="absolute flex flex-col items-center">
                                                    <span className="text-lg font-bold text-slate-700 font-mono">{(activeResult.availability * 100).toFixed(0)}%</span>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Availability</span>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-semibold text-slate-400 block">Uptime Ratio</span>
                                        </div>

                                        {/* Dial 3: Performance */}
                                        <div className="text-center space-y-2">
                                            <div className="relative w-24 h-24 flex items-center justify-center">
                                                <svg className="w-full h-full transform -rotate-90">
                                                    <circle cx="48" cy="48" r="40" stroke="#f1f5f9" strokeWidth="6" fill="transparent" />
                                                    <circle
                                                        cx="48" cy="48" r="40"
                                                        stroke="#f59e0b" strokeWidth="7" fill="transparent"
                                                        strokeDasharray={2 * Math.PI * 40}
                                                        strokeDashoffset={2 * Math.PI * 40 * (1 - activeResult.performance)}
                                                        strokeLinecap="round"
                                                        className="transition-all duration-1000 ease-out"
                                                    />
                                                </svg>
                                                <div className="absolute flex flex-col items-center">
                                                    <span className="text-lg font-bold text-slate-700 font-mono">{(activeResult.performance * 100).toFixed(0)}%</span>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Performance</span>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-semibold text-slate-400 block">Speed Efficiency</span>
                                        </div>

                                        {/* Dial 4: Quality */}
                                        <div className="text-center space-y-2">
                                            <div className="relative w-24 h-24 flex items-center justify-center">
                                                <svg className="w-full h-full transform -rotate-90">
                                                    <circle cx="48" cy="48" r="40" stroke="#f1f5f9" strokeWidth="6" fill="transparent" />
                                                    <circle
                                                        cx="48" cy="48" r="40"
                                                        stroke="#10b981" strokeWidth="7" fill="transparent"
                                                        strokeDasharray={2 * Math.PI * 40}
                                                        strokeDashoffset={2 * Math.PI * 40 * (1 - activeResult.quality)}
                                                        strokeLinecap="round"
                                                        className="transition-all duration-1000 ease-out"
                                                    />
                                                </svg>
                                                <div className="absolute flex flex-col items-center">
                                                    <span className="text-lg font-bold text-slate-700 font-mono">{(activeResult.quality * 100).toFixed(0)}%</span>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Quality</span>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-semibold text-slate-400 block">Good Units Ratio</span>
                                        </div>
                                    </div>

                                    {/* Equivalency loss ledger bars */}
                                    <div className="pt-6 space-y-4">
                                        <span className="text-xs font-bold text-slate-700 block">Planned Hours Allocation & equivalent losses:</span>
                                        <div className="h-6 w-full bg-slate-100 rounded-lg overflow-hidden flex shadow-inner">
                                            {/* Net productive time (OEE) */}
                                            <div
                                                style={{ width: `${activeResult.oee * 100}%` }}
                                                className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full flex items-center justify-center text-white text-[9px] font-bold"
                                                title={`Net Productive Time: ${activeResult.netProductiveHours.toFixed(1)} hrs`}
                                            >
                                                {activeResult.oee > 0.15 && `${activeResult.netProductiveHours.toFixed(1)}h Productive`}
                                            </div>
                                            {/* Availability Loss */}
                                            <div
                                                style={{ width: `${(activeResult.availabilityLossHours / activeResult.plannedTime) * 100}%` }}
                                                className="bg-blue-500/80 h-full flex items-center justify-center text-white text-[9px] font-bold"
                                                title={`Availability Loss: ${activeResult.availabilityLossHours.toFixed(1)} hrs`}
                                            >
                                                {activeResult.availabilityLossHours / activeResult.plannedTime > 0.08 && `${activeResult.availabilityLossHours.toFixed(0)}h Avail`}
                                            </div>
                                            {/* Performance Loss */}
                                            <div
                                                style={{ width: `${(activeResult.performanceLossHours / activeResult.plannedTime) * 100}%` }}
                                                className="bg-amber-500/80 h-full flex items-center justify-center text-white text-[9px] font-bold"
                                                title={`Performance Loss: ${activeResult.performanceLossHours.toFixed(1)} hrs`}
                                            >
                                                {activeResult.performanceLossHours / activeResult.plannedTime > 0.08 && `${activeResult.performanceLossHours.toFixed(0)}h Speed`}
                                            </div>
                                            {/* Quality Loss */}
                                            <div
                                                style={{ width: `${(activeResult.qualityLossHours / activeResult.plannedTime) * 100}%` }}
                                                className="bg-emerald-500/80 h-full flex items-center justify-center text-white text-[9px] font-bold"
                                                title={`Quality Loss: ${activeResult.qualityLossHours.toFixed(1)} hrs`}
                                            >
                                                {activeResult.qualityLossHours / activeResult.plannedTime > 0.08 && `${activeResult.qualityLossHours.toFixed(0)}h Quality`}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                            <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                                                <div className="text-slate-400 text-[9px] font-bold uppercase">Net Productive Time</div>
                                                <div className="text-sm font-black text-indigo-700">{activeResult.netProductiveHours.toFixed(1)} hrs</div>
                                            </div>
                                            <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                                <div className="text-slate-400 text-[9px] font-bold uppercase">Availability Loss</div>
                                                <div className="text-sm font-black text-blue-700">{activeResult.availabilityLossHours.toFixed(1)} hrs</div>
                                            </div>
                                            <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                                                <div className="text-slate-400 text-[9px] font-bold uppercase">Performance Loss</div>
                                                <div className="text-sm font-black text-amber-700">{activeResult.performanceLossHours.toFixed(1)} hrs</div>
                                            </div>
                                            <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-100">
                                                <div className="text-slate-400 text-[9px] font-bold uppercase">Quality Loss</div>
                                                <div className="text-sm font-black text-emerald-700">{activeResult.qualityLossHours.toFixed(1)} hrs</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* AI Advisory Panel inline */}
                                {aiAdvisory && (
                                    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-xl p-5 space-y-3 shadow-lg animate-in fade-in duration-300">
                                        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                                            <span className="flex items-center gap-2 text-xs font-bold text-yellow-500 uppercase tracking-wider">
                                                <Sparkles size={14} /> AI Reliability Advisor Report
                                            </span>
                                            <button
                                                onClick={() => setAiAdvisory(null)}
                                                className="text-xs text-slate-500 hover:text-slate-300 font-semibold"
                                            >
                                                ✕ Hide
                                            </button>
                                        </div>
                                        <div className="text-xs space-y-2 leading-relaxed font-sans text-slate-300">
                                            <p className="font-bold text-white text-sm">Constraint Isolated: Primary loss driver is availability / speed constraints.</p>
                                            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg text-[11px] font-mono text-emerald-400 space-y-2">
                                                <p className="font-bold text-white">📋 Recommended Mitigation Checklist:</p>
                                                <p>1. Audit recent PM intervals against manufacturer specification sheets.</p>
                                                <p>2. Cross-reference downtime instances with spare-parts warehouse stockout records.</p>
                                                <p>3. Spool historical failure logs to verify matching failure modes.</p>
                                            </div>
                                            <p className="text-[10px] text-slate-500 italic mt-2">Recommended: Initiate an RCA and Defect Elimination task in the DE tab to track this asset's corrective action lifecycle.</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
                                <Gauge size={48} className="mx-auto text-slate-300 mb-3 animate-pulse" />
                                <span className="font-bold text-slate-600 block text-sm">No Calculations Run Yet</span>
                                <span className="text-xs text-slate-400 max-w-xs mx-auto block mt-1">Enter your production numbers on the left and run calculation to populate this diagnostic dashboard.</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── TAB 2: COMPARE & RANK ───────────────────────── */}
            {activeTab === 'compare' && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
                    <div>
                        <h3 className="font-bold text-slate-800 text-base">Asset OEE Ranking Comparison</h3>
                        <p className="text-slate-400 text-xs mt-1">Sorted in descending order of productivity. Standard EAM target for oil & gas assets is 85.0% OEE (World Class).</p>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left text-slate-500">
                            <thead className="text-[10px] text-slate-400 uppercase bg-slate-50 font-bold">
                                <tr>
                                    <th className="px-4 py-3">Rank</th>
                                    <th className="px-4 py-3">Asset</th>
                                    <th className="px-4 py-3">OEE Score</th>
                                    <th className="px-4 py-3">Availability</th>
                                    <th className="px-4 py-3">Performance</th>
                                    <th className="px-4 py-3">Quality</th>
                                    <th className="px-4 py-3">Capacity / Rate</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                                {[...history]
                                    .sort((a, b) => b.oee - a.oee)
                                    .map((rec, index) => (
                                        <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-3.5">
                                                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black ${index === 0 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-500'}`}>
                                                    {index + 1}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 font-bold text-slate-800">{rec.assetName}</td>
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-12 bg-slate-100 rounded-full h-1.5">
                                                        <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${rec.oee * 100}%` }} />
                                                    </div>
                                                    <span className="font-mono font-black">{(rec.oee * 100).toFixed(1)}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-slate-600">{(rec.availability * 100).toFixed(0)}%</td>
                                            <td className="px-4 py-3.5 font-mono text-slate-600">
                                                {(rec.performance * 100).toFixed(0)}%
                                                {rec.rawPerformance > 1.0 && <span className="text-[9px] text-emerald-500 font-bold ml-1">({(rec.rawPerformance * 100).toFixed(0)}% raw)</span>}
                                            </td>
                                            <td className="px-4 py-3.5 font-mono text-slate-600">{(rec.quality * 100).toFixed(0)}%</td>
                                            <td className="px-4 py-3.5 text-slate-500">{rec.totalProduced.toLocaleString()} / {rec.goodProduced.toLocaleString()} ({rec.idealRate}/h)</td>
                                            <td className="px-4 py-3.5 text-right space-x-1.5">
                                                <button
                                                    onClick={() => handleLoadInput(rec)}
                                                    className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-600 text-[10px] font-bold rounded hover:bg-indigo-100 transition-colors"
                                                >
                                                    Select
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                {history.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center py-6 text-slate-400">No records to compare. Add some runs in the calculator.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── TAB 3: HISTORICAL RUNS ─────────────────────── */}
            {activeTab === 'history' && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-slate-800 text-base">OEE Calculation Run History</h3>
                            <p className="text-slate-400 text-xs mt-1">Saves locally to your browser localStorage. Up to 15 calculations are stored chronologically.</p>
                        </div>
                        {history.length > 0 && (
                            <button
                                onClick={() => {
                                    setHistory([]);
                                    localStorage.removeItem('ers_oee_history');
                                    setActiveResult(null);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 font-semibold rounded-lg text-xs hover:bg-red-100 transition-colors"
                            >
                                <Trash2 size={12} /> Clear All History
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {history.map((rec) => (
                            <div
                                key={rec.id}
                                onClick={() => handleLoadInput(rec)}
                                className={`p-4 rounded-xl border transition-all cursor-pointer relative group ${activeResult?.id === rec.id ? 'border-indigo-500 bg-indigo-50/20 shadow-md scale-[1.01]' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
                            >
                                <button
                                    onClick={(e) => handleDeleteHistory(rec.id, e)}
                                    className="absolute top-3 right-3 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                                    title="Delete record"
                                >
                                    <Trash2 size={12} />
                                </button>
                                <div className="space-y-2">
                                    <span className="text-[9px] text-slate-400 font-bold block">{rec.timestamp}</span>
                                    <span className="font-bold text-slate-800 text-xs block truncate pr-5">{rec.assetName}</span>
                                    <div className="flex items-end justify-between pt-1 border-t border-slate-100">
                                        <div className="space-y-0.5">
                                            <span className="text-[8px] font-bold text-slate-400 uppercase block">OEE Score</span>
                                            <span className="text-lg font-black text-slate-700 font-mono">{(rec.oee * 100).toFixed(0)}%</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500 flex gap-2 font-mono">
                                            <span>A:{(rec.availability * 100).toFixed(0)}%</span>
                                            <span>P:{(rec.performance * 100).toFixed(0)}%</span>
                                            <span>Q:{(rec.quality * 100).toFixed(0)}%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {history.length === 0 && (
                            <div className="col-span-full text-center py-12 text-slate-400">No records stored yet.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
