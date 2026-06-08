import React, { useState } from 'react';
import { BarChart2, Cpu, DollarSign, Clock, Activity, Shield, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import type { GovernanceTier } from '../../types/intelligence';

// ─────────────────────────────────────────────────────────
//  Strategy Definitions & Mock Data
// ─────────────────────────────────────────────────────────

type Strategy = 'current_pm' | 'rcm' | 'cbm' | 'rtf';

const STRATEGY_META: Record<Strategy, { label: string; description: string; icon: React.ReactNode; color: string }> = {
    current_pm: { label: 'Current PM', description: 'Time-based preventive maintenance as currently scheduled', icon: <Clock size={18} />, color: 'text-brand-300 bg-brand-700 border-brand-600' },
    rcm: { label: 'RCM', description: 'Reliability Centered Maintenance — task-focused, failure-mode driven', icon: <Shield size={18} />, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
    cbm: { label: 'Condition-Based', description: 'Monitor-and-maintain using vibration, temperature, and oil analysis', icon: <Activity size={18} />, color: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30' },
    rtf: { label: 'Run-to-Failure', description: 'Operate until failure — only for non-critical/redundant assets', icon: <Zap size={18} />, color: 'text-red-400 bg-red-500/10 border-red-500/30' },
};

interface StrategyResult {
    strategy: Strategy;
    availability_pct: number;
    mtbf_days: number;
    annual_cost_usd: number;
    failure_prob_1yr: number;
    governance_tier: GovernanceTier;
}

const MOCK_RESULTS: StrategyResult[] = [
    { strategy: 'current_pm', availability_pct: 94.2, mtbf_days: 185, annual_cost_usd: 142000, failure_prob_1yr: 0.32, governance_tier: 3 },
    { strategy: 'rcm', availability_pct: 96.8, mtbf_days: 260, annual_cost_usd: 118000, failure_prob_1yr: 0.18, governance_tier: 3 },
    { strategy: 'cbm', availability_pct: 97.5, mtbf_days: 310, annual_cost_usd: 105000, failure_prob_1yr: 0.12, governance_tier: 2 },
    { strategy: 'rtf', availability_pct: 82.1, mtbf_days: 95, annual_cost_usd: 210000, failure_prob_1yr: 0.65, governance_tier: 4 },
];

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const MonteCarloPanel: React.FC = () => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [selectedStrategy, setSelectedStrategy] = useState<Strategy>('rcm');

    const baseline = MOCK_RESULTS.find(r => r.strategy === 'current_pm')!;
    const proposed = MOCK_RESULTS.find(r => r.strategy === selectedStrategy)!;

    const delta = {
        availability: proposed.availability_pct - baseline.availability_pct,
        mtbf: proposed.mtbf_days - baseline.mtbf_days,
        cost: proposed.annual_cost_usd - baseline.annual_cost_usd,
        failure_prob: proposed.failure_prob_1yr - baseline.failure_prob_1yr,
    };

    const recommendation = selectedStrategy === 'cbm'
        ? 'Condition-Based Maintenance delivers the highest availability (+3.3%) and lowest annual cost ($105k). Requires investment in vibration monitoring and oil analysis infrastructure. Recommended for Criticality A/B assets.'
        : selectedStrategy === 'rcm'
            ? 'RCM offers a balanced improvement with +2.6% availability and $24k annual savings. The failure-mode-driven approach ensures maintenance tasks are optimized. Suitable for all criticality levels.'
            : selectedStrategy === 'rtf'
                ? 'Warning: Run-to-Failure reduces availability by 12.1% and increases annual cost by $68k due to unplanned downtime and emergency repairs. Not recommended for Criticality A assets.'
                : 'Current PM strategy is the baseline. Consider switching to RCM or CBM for measurable reliability and cost improvements.';

    const DeltaBar = ({ value, unit, invert = false }: { value: number; unit: string; invert?: boolean }) => {
        const isPositive = invert ? value < 0 : value > 0;
        const color = isPositive ? 'text-accent-safe' : value === 0 ? 'text-brand-400' : 'text-red-400';
        const barColor = isPositive ? 'bg-accent-safe' : 'bg-red-500';
        const maxVal = Math.max(
            Math.abs(delta.availability) * 3,
            Math.abs(delta.cost) / 5000,
            Math.abs(delta.mtbf) / 5,
            10
        );
        const pct = Math.min(100, (Math.abs(value) / maxVal) * 100);

        return (
            <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-brand-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full ${barColor} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <span className={`text-xs font-bold min-w-[60px] text-right ${color}`}>
                    {value > 0 ? '+' : ''}{unit === '$' ? '$' + Math.abs(value).toLocaleString() : value.toFixed(1) + unit}
                </span>
            </div>
        );
    };

    return (
        <div className="bg-brand-800 border border-brand-700 rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-brand-700/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                        <BarChart2 size={20} />
                    </div>
                    <div className="text-left">
                        <h3 className="text-base sm:text-lg font-semibold text-brand-100">Monte Carlo Strategy Comparison</h3>
                        <p className="text-xs text-brand-400">Compare maintenance strategies against current PM baseline</p>
                    </div>
                </div>
                {isExpanded ? <ChevronUp size={16} className="text-brand-400" /> : <ChevronDown size={16} className="text-brand-400" />}
            </button>

            {isExpanded && (
                <div className="border-t border-brand-700 p-4 sm:p-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
                    {/* Strategy Selector */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {(Object.keys(STRATEGY_META) as Strategy[]).map(key => {
                            const meta = STRATEGY_META[key];
                            const isSelected = selectedStrategy === key;
                            const isBaseline = key === 'current_pm';
                            return (
                                <button
                                    key={key}
                                    onClick={() => setSelectedStrategy(key)}
                                    className={`p-3 rounded-xl border text-left transition-all ${isSelected
                                        ? `${meta.color} ring-2 ring-current/30 shadow-lg`
                                        : 'bg-brand-700/50 border-brand-600 text-brand-300 hover:border-brand-500'
                                        }`}
                                >
                                    <div className="flex items-center gap-2 mb-1.5">
                                        {meta.icon}
                                        <span className="text-sm font-semibold">{meta.label}</span>
                                    </div>
                                    <p className="text-[10px] opacity-70 leading-snug">{meta.description}</p>
                                    {isBaseline && (
                                        <span className="mt-2 inline-block text-[9px] font-bold uppercase tracking-wider bg-brand-600 px-1.5 py-0.5 rounded text-brand-300">
                                            Baseline
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Comparison Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {/* Availability */}
                        <div className="bg-brand-700/50 border border-brand-600 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-3">
                                <Activity size={14} className="text-brand-400" />
                                <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Availability</span>
                            </div>
                            <div className="flex items-end justify-between mb-2">
                                <div>
                                    <p className="text-[10px] text-brand-400">Baseline</p>
                                    <p className="text-sm font-bold text-brand-300">{baseline.availability_pct.toFixed(1)}%</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-brand-400">Proposed</p>
                                    <p className="text-sm font-bold text-brand-100">{proposed.availability_pct.toFixed(1)}%</p>
                                </div>
                            </div>
                            <DeltaBar value={delta.availability} unit="%" />
                        </div>

                        {/* MTBF */}
                        <div className="bg-brand-700/50 border border-brand-600 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-3">
                                <Clock size={14} className="text-brand-400" />
                                <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">MTBF</span>
                            </div>
                            <div className="flex items-end justify-between mb-2">
                                <div>
                                    <p className="text-[10px] text-brand-400">Baseline</p>
                                    <p className="text-sm font-bold text-brand-300">{baseline.mtbf_days}d</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-brand-400">Proposed</p>
                                    <p className="text-sm font-bold text-brand-100">{proposed.mtbf_days}d</p>
                                </div>
                            </div>
                            <DeltaBar value={delta.mtbf} unit="d" />
                        </div>

                        {/* Annual Cost */}
                        <div className="bg-brand-700/50 border border-brand-600 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-3">
                                <DollarSign size={14} className="text-brand-400" />
                                <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Annual Cost</span>
                            </div>
                            <div className="flex items-end justify-between mb-2">
                                <div>
                                    <p className="text-[10px] text-brand-400">Baseline</p>
                                    <p className="text-sm font-bold text-brand-300">${(baseline.annual_cost_usd / 1000).toFixed(0)}k</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-brand-400">Proposed</p>
                                    <p className="text-sm font-bold text-brand-100">${(proposed.annual_cost_usd / 1000).toFixed(0)}k</p>
                                </div>
                            </div>
                            <DeltaBar value={delta.cost} unit="$" invert />
                        </div>

                        {/* Failure Probability */}
                        <div className="bg-brand-700/50 border border-brand-600 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-3">
                                <Shield size={14} className="text-brand-400" />
                                <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">P(Failure)</span>
                            </div>
                            <div className="flex items-end justify-between mb-2">
                                <div>
                                    <p className="text-[10px] text-brand-400">Baseline</p>
                                    <p className="text-sm font-bold text-brand-300">{(baseline.failure_prob_1yr * 100).toFixed(0)}%</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-brand-400">Proposed</p>
                                    <p className="text-sm font-bold text-brand-100">{(proposed.failure_prob_1yr * 100).toFixed(0)}%</p>
                                </div>
                            </div>
                            <DeltaBar value={delta.failure_prob * 100} unit="%" invert />
                        </div>
                    </div>

                    {/* AI Recommendation */}
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Cpu size={14} className="text-blue-400" />
                            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">AI Recommendation</span>
                            <span className="text-[10px] font-mono bg-brand-700 border border-brand-600 px-1.5 py-0.5 rounded text-brand-300 ml-auto">
                                T{proposed.governance_tier} · 5,000 MC runs
                            </span>
                        </div>
                        <p className="text-sm text-brand-200 leading-relaxed">{recommendation}</p>
                    </div>
                </div>
            )}
        </div>
    );
};
