import React, { useState } from 'react';
import { Sliders, Play, TrendingUp, TrendingDown, Minus, Cpu, DollarSign, Clock, Activity, Shield, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import type { ScenarioInput, ScenarioOutput, ScenarioMetrics, GovernanceTier } from '../../types/intelligence';

// ─────────────────────────────────────────────────────────
//  Mock Scenario Engine (simulates backend Monte Carlo)
// ─────────────────────────────────────────────────────────

function runMockScenario(input: ScenarioInput): ScenarioOutput {
    // Baseline metrics (current state)
    const baseline: ScenarioMetrics = {
        availability_pct: 94.2,
        mtbf_days: 185,
        annual_cost_usd: 142000,
        failure_probability_1yr: 0.32,
        confidence_interval: [0.24, 0.41],
    };

    // Calculate projected metrics based on slider inputs
    const pmFactor = (180 - input.pm_interval_days) / 365;  // shorter interval = better
    const loadPenalty = (input.load_factor - 1.0) * 15;      // overload = worse
    const tempPenalty = Math.max(0, input.temp_delta_c - 10) * 0.3; // high temp = worse

    const availDelta = pmFactor * 3.5 - loadPenalty * 0.2 - tempPenalty * 0.15;
    const mtbfDelta = pmFactor * 40 - loadPenalty * 8 - tempPenalty * 3;
    const costDelta = -pmFactor * 18000 + loadPenalty * 4500 + tempPenalty * 2200;
    const failDelta = -pmFactor * 0.08 + loadPenalty * 0.03 + tempPenalty * 0.02;

    const projected: ScenarioMetrics = {
        availability_pct: Math.min(99.9, Math.max(80, baseline.availability_pct + availDelta)),
        mtbf_days: Math.max(30, baseline.mtbf_days + mtbfDelta),
        annual_cost_usd: Math.max(20000, baseline.annual_cost_usd + costDelta),
        failure_probability_1yr: Math.min(0.95, Math.max(0.02, baseline.failure_probability_1yr + failDelta)),
        confidence_interval: [
            Math.max(0.01, baseline.failure_probability_1yr + failDelta - 0.08),
            Math.min(0.99, baseline.failure_probability_1yr + failDelta + 0.09)
        ],
    };

    const delta = {
        availability: projected.availability_pct - baseline.availability_pct,
        mtbf: projected.mtbf_days - baseline.mtbf_days,
        cost: projected.annual_cost_usd - baseline.annual_cost_usd,
        failure_prob: projected.failure_probability_1yr - baseline.failure_probability_1yr,
    };

    // Generate recommendation
    let recommendation = '';
    if (delta.availability > 1) {
        recommendation = `Proposed changes improve availability by +${delta.availability.toFixed(1)}% and extend MTBF by ${delta.mtbf.toFixed(0)} days. The ${delta.cost < 0 ? 'cost reduction of $' + Math.abs(delta.cost).toLocaleString() : 'additional cost of $' + delta.cost.toLocaleString()} per year is ${delta.cost < 0 ? 'a net benefit' : 'justified by the reliability improvement'}. Recommended for implementation.`;
    } else if (delta.availability < -1) {
        recommendation = `Warning: Proposed changes degrade availability by ${delta.availability.toFixed(1)}%. The reduced PM frequency increases failure probability by ${(delta.failure_prob * 100).toFixed(1)}%. Consider reverting PM interval or reducing load factor.`;
    } else {
        recommendation = `Marginal impact on availability (${delta.availability > 0 ? '+' : ''}${delta.availability.toFixed(1)}%). Cost impact: ${delta.cost < 0 ? 'savings of $' : 'increase of $'}${Math.abs(delta.cost).toLocaleString()}/yr. Consider whether the operational changes justify the effort.`;
    }

    return {
        scenario: input,
        baseline,
        projected,
        delta,
        recommendation,
        governance_tier: (input.load_factor > 1.2 || input.temp_delta_c > 25) ? 2 : 3 as GovernanceTier,
        monte_carlo_runs: 5000,
    };
}

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

interface Props {
    assetId: string;
    assetName?: string;
}

export const ScenarioSimulator: React.FC<Props> = ({ assetId, assetName }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [pmInterval, setPmInterval] = useState(180);
    const [loadFactor, setLoadFactor] = useState(1.0);
    const [tempDelta, setTempDelta] = useState(0);
    const [result, setResult] = useState<ScenarioOutput | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    const handleRun = () => {
        setIsRunning(true);
        // Simulate computation delay
        setTimeout(() => {
            const output = runMockScenario({
                scenario_name: `What-If — ${assetName || assetId}`,
                pm_interval_days: pmInterval,
                load_factor: loadFactor,
                temp_delta_c: tempDelta,
                strategy: 'current_pm',
            });
            setResult(output);
            setIsRunning(false);
        }, 800);
    };

    const handleReset = () => {
        setPmInterval(180);
        setLoadFactor(1.0);
        setTempDelta(0);
        setResult(null);
    };

    const DeltaIndicator = ({ value, unit, invert = false }: { value: number; unit: string; invert?: boolean }) => {
        const isPositive = invert ? value < 0 : value > 0;
        const color = isPositive ? 'text-accent-safe' : value === 0 ? 'text-slate-500' : 'text-red-400';
        const Icon = isPositive ? TrendingUp : value === 0 ? Minus : TrendingDown;
        return (
            <div className={`flex items-center gap-1 text-xs font-bold ${color}`}>
                <Icon size={12} />
                <span>{value > 0 ? '+' : ''}{unit === '$' ? '$' : ''}{unit === '$' ? Math.abs(value).toLocaleString() : typeof value === 'number' ? (unit === '%' ? value.toFixed(1) : value.toFixed(0)) : value}{unit !== '$' ? unit : ''}</span>
            </div>
        );
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-5 flex items-center justify-between hover:bg-slate-100/30 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                        <Sliders size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="text-base font-semibold text-slate-800">What-If Scenario Simulator</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Monte Carlo · {result ? `${result.monte_carlo_runs.toLocaleString()} runs` : 'Adjust parameters and run simulation'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {result && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-full border ${result.delta.availability > 0 ? 'bg-accent-safe/10 text-accent-safe border-accent-safe/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                            {result.delta.availability > 0 ? '↑' : '↓'} {Math.abs(result.delta.availability).toFixed(1)}% avail.
                        </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-slate-200 p-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
                    {/* Sliders */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {/* PM Interval */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">PM Interval</label>
                                <span className="text-sm font-mono text-accent-cyan font-bold">{pmInterval}d</span>
                            </div>
                            <input
                                type="range" min={30} max={365} step={15} value={pmInterval}
                                onChange={e => setPmInterval(Number(e.target.value))}
                                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                            />
                            <div className="flex justify-between text-[10px] text-brand-600 mt-1">
                                <span>30 days</span><span>365 days</span>
                            </div>
                        </div>

                        {/* Load Factor */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Load Factor</label>
                                <span className={`text-sm font-mono font-bold ${loadFactor > 1.2 ? 'text-red-400' : loadFactor > 1.0 ? 'text-yellow-500' : 'text-accent-cyan'}`}>{loadFactor.toFixed(2)}×</span>
                            </div>
                            <input
                                type="range" min={50} max={150} step={5} value={loadFactor * 100}
                                onChange={e => setLoadFactor(Number(e.target.value) / 100)}
                                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                            />
                            <div className="flex justify-between text-[10px] text-brand-600 mt-1">
                                <span>0.50×</span><span>1.50×</span>
                            </div>
                        </div>

                        {/* Temperature Delta */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Temp Δ</label>
                                <span className={`text-sm font-mono font-bold ${tempDelta > 25 ? 'text-red-400' : tempDelta > 10 ? 'text-yellow-500' : 'text-accent-cyan'}`}>{tempDelta > 0 ? '+' : ''}{tempDelta}°C</span>
                            </div>
                            <input
                                type="range" min={-20} max={40} step={5} value={tempDelta}
                                onChange={e => setTempDelta(Number(e.target.value))}
                                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                            />
                            <div className="flex justify-between text-[10px] text-brand-600 mt-1">
                                <span>-20°C</span><span>+40°C</span>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleRun}
                            disabled={isRunning}
                            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-all shadow-[0_0_20px_rgba(168,85,247,0.2)]"
                        >
                            {isRunning ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Running Monte Carlo…
                                </>
                            ) : (
                                <>
                                    <Play size={14} /> Run Simulation
                                </>
                            )}
                        </button>
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg text-sm transition-colors"
                        >
                            <RotateCcw size={14} /> Reset
                        </button>
                    </div>

                    {/* Results */}
                    {result && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            {/* Comparison Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {/* Availability */}
                                <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Activity size={14} className="text-slate-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Availability</span>
                                    </div>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <p className="text-xs text-slate-400">Baseline</p>
                                            <p className="text-lg font-bold text-slate-600">{result.baseline.availability_pct.toFixed(1)}%</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-400">Projected</p>
                                            <p className="text-lg font-bold text-slate-800">{result.projected.availability_pct.toFixed(1)}%</p>
                                        </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-brand-800">
                                        <DeltaIndicator value={result.delta.availability} unit="%" />
                                    </div>
                                </div>

                                {/* MTBF */}
                                <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Clock size={14} className="text-slate-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">MTBF</span>
                                    </div>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <p className="text-xs text-slate-400">Baseline</p>
                                            <p className="text-lg font-bold text-slate-600">{result.baseline.mtbf_days}d</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-400">Projected</p>
                                            <p className="text-lg font-bold text-slate-800">{result.projected.mtbf_days.toFixed(0)}d</p>
                                        </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-brand-800">
                                        <DeltaIndicator value={result.delta.mtbf} unit=" days" />
                                    </div>
                                </div>

                                {/* Annual Cost */}
                                <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <DollarSign size={14} className="text-slate-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Annual Cost</span>
                                    </div>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <p className="text-xs text-slate-400">Baseline</p>
                                            <p className="text-lg font-bold text-slate-600">${(result.baseline.annual_cost_usd / 1000).toFixed(0)}k</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-400">Projected</p>
                                            <p className="text-lg font-bold text-slate-800">${(result.projected.annual_cost_usd / 1000).toFixed(0)}k</p>
                                        </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-brand-800">
                                        <DeltaIndicator value={result.delta.cost} unit="$" invert />
                                    </div>
                                </div>

                                {/* Failure Probability */}
                                <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Shield size={14} className="text-slate-400" />
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">P(Failure)</span>
                                    </div>
                                    <div className="flex items-end justify-between">
                                        <div>
                                            <p className="text-xs text-slate-400">Baseline</p>
                                            <p className="text-lg font-bold text-slate-600">{(result.baseline.failure_probability_1yr * 100).toFixed(0)}%</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-400">Projected</p>
                                            <p className="text-lg font-bold text-slate-800">{(result.projected.failure_probability_1yr * 100).toFixed(0)}%</p>
                                        </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-brand-800">
                                        <DeltaIndicator value={result.delta.failure_prob * 100} unit="%" invert />
                                    </div>
                                </div>
                            </div>

                            {/* AI Recommendation */}
                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Cpu size={14} className="text-blue-400" />
                                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">AI Recommendation</span>
                                    <span className="text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 ml-auto">
                                        T{result.governance_tier} · {result.monte_carlo_runs.toLocaleString()} runs
                                    </span>
                                </div>
                                <p className="text-sm text-slate-700 leading-relaxed">{result.recommendation}</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
