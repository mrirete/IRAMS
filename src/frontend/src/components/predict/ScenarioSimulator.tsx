import React, { useState, useMemo, useEffect } from 'react';
import { Sliders, Play, TrendingUp, TrendingDown, Minus, Cpu, DollarSign, Clock, Activity, Shield, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, Factory } from 'lucide-react';
import type { GroundedRul } from '../../lib/predict/groundedFit';
import type { ClassResolution } from '../../lib/predict/equipmentClass';
import {
    whatIfParamsFor, paramZone, runWhatIfComparison,
    DEFAULT_ECON, MC_RUNS, MISSION_HOURS, PRODUCTION_UNITS, formatTempDelta,
    type EconomicInputs, type WhatIfScenarioResult, type WhatIfParamDef,
} from '../../lib/predict/whatIf';

// ─────────────────────────────────────────────────────────
//  What-If Scenario Explorer (Phase 6 + financial extension)
//   REAL — fitted assets simulate through the Monte Carlo engine with
//   class-aware duty parameters (cited physics) and imperfect PM.
//   ILLUSTRATIVE — unfitted assets get a linear estimate, labelled.
//   Financials: downtime → lost production (units × margin) → net benefit.
// ─────────────────────────────────────────────────────────

interface UiResult {
    baseline: WhatIfScenarioResult;
    projected: WhatIfScenarioResult;
    netAnnualBenefit: number;
    extrapolated: boolean;
    /** null = illustrative (no simulation ran) */
    runs: number | null;
    recommendation: string;
}

// Illustrative fallback — linear penalties on a fixed baseline. NOT a
// simulation; only used (and labelled) when no fitted life model exists.
function mockComparison(defs: WhatIfParamDef[], values: Record<string, number>, econ: EconomicInputs): UiResult {
    const scenario = (vals: Record<string, number>): WhatIfScenarioResult => {
        const pmFactor = (180 - (vals.pmInterval ?? 180)) / 365;
        const stressDef = defs.find(d => d.key !== 'pmInterval' && d.key !== 'tempDelta');
        const stress = stressDef ? (vals[stressDef.key] ?? stressDef.neutral) - stressDef.neutral : 0;
        const temp = Math.max(0, (vals.tempDelta ?? 0) - 10) * 0.3;
        const avail = Math.min(99.9, Math.max(80, 94.2 + pmFactor * 3.5 - stress * 15 * 0.2 - temp * 0.15));
        const mtbfDays = Math.max(30, 185 + pmFactor * 40 - stress * 15 * 8 - temp * 3);
        const cost = Math.max(20000, 142000 - pmFactor * 18000 + stress * 15 * 4500 + temp * 2200);
        const pFail = Math.min(0.95, Math.max(0.02, 0.32 - pmFactor * 0.08 + stress * 15 * 0.03 + temp * 0.02));
        const downtime = ((100 - avail) / 100) * MISSION_HOURS;
        const lostUnits = econ.productionRate > 0 ? (downtime / 24) * econ.productionRate : 0;
        const lostValue = lostUnits * (econ.marginPerUnit || 0);
        return {
            metrics: {
                availability_pct: Math.round(avail * 100) / 100,
                mtbf_days: Math.round(mtbfDays),
                annual_cost_usd: Math.round(cost),
                failure_probability_1yr: Math.round(pFail * 1000) / 1000,
                confidence_interval: [Math.max(0.01, pFail - 0.08), Math.min(0.99, pFail + 0.09)],
            },
            financials: {
                downtimeHours: Math.round(downtime * 10) / 10,
                failuresPerYear: Math.round((365 / mtbfDays) * 10) / 10,
                maintenanceCost: Math.round(cost),
                lostProductionUnits: Math.round(lostUnits * 10) / 10,
                lostProductionValue: Math.round(lostValue),
                totalAnnualCost: Math.round(cost + lostValue),
            },
        };
    };
    const neutral = Object.fromEntries(defs.map(d => [d.key, d.neutral]));
    const baseline = scenario(neutral);
    const projected = scenario(values);
    const net = baseline.financials.totalAnnualCost - projected.financials.totalAnnualCost;
    return {
        baseline, projected,
        netAnnualBenefit: net,
        extrapolated: defs.some(d => paramZone(d, values[d.key] ?? d.neutral) === 'red'),
        runs: null,
        recommendation: net > 1000
            ? `Directional estimate: the change saves ~$${net.toLocaleString()}/yr all-in. Add failure history for a simulated answer.`
            : net < -1000
                ? `Directional estimate: the change costs ~$${Math.abs(net).toLocaleString()}/yr all-in. Add failure history for a simulated answer.`
                : 'Directional estimate: marginal impact. Add failure history for a simulated answer.',
    };
}

interface Props {
    assetId: string;
    assetName?: string;
    /** fitted censored Weibull — presence switches to the REAL Monte Carlo path */
    groundedFit?: GroundedRul | null;
    /** equipment class — selects the duty parameters & their physics */
    equipmentClass?: ClassResolution | null;
}

export const ScenarioSimulator: React.FC<Props> = ({ assetId, assetName, groundedFit, equipmentClass }) => {
    const hasFit = !!groundedFit && !!groundedFit.beta && !!groundedFit.eta;
    const cls = equipmentClass?.cls ?? 'other';
    const defs = useMemo(() => whatIfParamsFor(cls), [cls]);

    const [isExpanded, setIsExpanded] = useState(true);
    const [econOpen, setEconOpen] = useState(false);
    const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(defs.map(d => [d.key, d.neutral])));
    const [econ, setEcon] = useState<EconomicInputs>(() => {
        try { return { ...DEFAULT_ECON, ...JSON.parse(localStorage.getItem(`predict.whatif.${assetId}`) || '{}') }; }
        catch { return DEFAULT_ECON; }
    });
    const [result, setResult] = useState<UiResult | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    // Display preference only — the physics stays in °C deltas.
    const [tempUnit, setTempUnit] = useState<'C' | 'F'>(() => {
        try { return localStorage.getItem('predict.whatif.tempUnit') === 'F' ? 'F' : 'C'; } catch { return 'C'; }
    });
    const toggleTempUnit = () => setTempUnit(prev => {
        const next = prev === 'C' ? 'F' : 'C';
        try { localStorage.setItem('predict.whatif.tempUnit', next); } catch { /* ignore */ }
        return next;
    });

    // Class change re-seeds the slider set; economics persist per asset.
    useEffect(() => {
        setValues(Object.fromEntries(defs.map(d => [d.key, d.neutral])));
        setResult(null);
    }, [defs]);
    useEffect(() => {
        try { localStorage.setItem(`predict.whatif.${assetId}`, JSON.stringify(econ)); } catch { /* ignore */ }
    }, [assetId, econ]);

    const setValue = (key: string, v: number) => setValues(prev => ({ ...prev, [key]: v }));
    const setEconField = (key: keyof EconomicInputs, v: number | string) => setEcon(prev => ({ ...prev, [key]: v }));

    const handleRun = () => {
        setIsRunning(true);
        setTimeout(() => {
            try {
                const out = hasFit && groundedFit
                    ? (() => {
                        const c = runWhatIfComparison(groundedFit, cls, values, econ);
                        const dAvail = c.projected.metrics.availability_pct - c.baseline.metrics.availability_pct;
                        const rec = c.netAnnualBenefit > 1000
                            ? `Simulated (β=${groundedFit.beta}, η adjusted for duty): the change saves $${c.netAnnualBenefit.toLocaleString()}/yr all-in (maintenance + lost production), availability ${dAvail >= 0 ? '+' : ''}${dAvail.toFixed(2)}pp.`
                            : c.netAnnualBenefit < -1000
                                ? `Simulated: the change costs $${Math.abs(c.netAnnualBenefit).toLocaleString()}/yr all-in — availability ${dAvail >= 0 ? '+' : ''}${dAvail.toFixed(2)}pp doesn't pay for it. Revisit the PM interval or duty.`
                                : `Simulated: financially marginal (${dAvail >= 0 ? '+' : ''}${dAvail.toFixed(2)}pp availability). Judge on operational grounds.`;
                        return { ...c, recommendation: rec } as UiResult;
                    })()
                    : mockComparison(defs, values, econ);
                setResult(out);
            } finally {
                setIsRunning(false);
            }
        }, 50);
    };

    const handleReset = () => {
        setValues(Object.fromEntries(defs.map(d => [d.key, d.neutral])));
        setResult(null);
    };

    const DeltaIndicator = ({ value, unit, invert = false, digits = 1 }: { value: number; unit: string; invert?: boolean; digits?: number }) => {
        const isPositive = invert ? value < 0 : value > 0;
        const color = isPositive ? 'text-accent-safe' : value === 0 ? 'text-slate-500' : 'text-red-400';
        const Icon = isPositive ? TrendingUp : value === 0 ? Minus : TrendingDown;
        return (
            <div className={`flex items-center gap-1 text-xs font-bold ${color}`}>
                <Icon size={12} />
                <span>{value > 0 ? '+' : value < 0 ? '−' : ''}{unit === '$' ? '$' : ''}{Math.abs(unit === '$' ? Math.round(value) : value).toLocaleString(undefined, { maximumFractionDigits: unit === '$' ? 0 : digits })}{unit !== '$' ? unit : ''}</span>
            </div>
        );
    };

    const CompareCard = ({ icon, label, base, proj, delta, unit, invert, fmt }: {
        icon: React.ReactNode; label: string; base: number; proj: number; delta: number; unit: string; invert?: boolean;
        fmt: (v: number) => string;
    }) => (
        <div className="bg-slate-50 border border-slate-300 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-2">
                {icon}
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
            </div>
            <div className="flex items-end justify-between">
                <div><p className="text-xs text-slate-400">Baseline</p><p className="text-lg font-bold text-slate-600">{fmt(base)}</p></div>
                <div className="text-right"><p className="text-xs text-slate-400">Projected</p><p className="text-lg font-bold text-slate-800">{fmt(proj)}</p></div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200">
                <DeltaIndicator value={delta} unit={unit} invert={invert} />
            </div>
        </div>
    );

    const econNum = (label: string, key: keyof EconomicInputs, step = 1, prefix = '') => (
        <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="relative mt-1">
                {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
                <input
                    type="number" step={step} value={econ[key] as number}
                    onChange={e => setEconField(key, Number(e.target.value))}
                    className={`w-full ${prefix ? 'pl-5' : 'pl-2'} pr-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right tabular-nums`}
                />
            </div>
        </label>
    );

    const fin = result ? {
        dDowntime: result.projected.financials.downtimeHours - result.baseline.financials.downtimeHours,
        dLostUnits: result.projected.financials.lostProductionUnits - result.baseline.financials.lostProductionUnits,
        dLostValue: result.projected.financials.lostProductionValue - result.baseline.financials.lostProductionValue,
    } : null;
    const hasProduction = econ.productionRate > 0 && econ.marginPerUnit > 0;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-5 flex items-center justify-between hover:bg-slate-100/30 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400"><Sliders size={20} /></div>
                    <div className="text-left">
                        <h3 className="text-base font-semibold text-slate-800">What-If Scenario Explorer</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {hasFit
                                ? `Monte Carlo simulation — fitted β=${groundedFit!.beta}, η=${Math.round(groundedFit!.eta! / 24)}d · ${MC_RUNS.toLocaleString()} runs per scenario · ${cls} duty model`
                                : `Illustrative estimate — directional only (a fitted life model enables real simulation) · ${cls} duty model`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {result && (
                        <span className={`text-xs font-bold px-2 py-1 rounded-full border ${result.netAnnualBenefit >= 0 ? 'bg-accent-safe/10 text-accent-safe border-accent-safe/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                            {result.netAnnualBenefit >= 0 ? '↑ saves' : '↓ costs'} ${Math.abs(result.netAnnualBenefit).toLocaleString()}/yr
                        </span>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-slate-200 p-5 space-y-5 animate-in slide-in-from-top-2 duration-200">
                    {/* Class-aware duty sliders with envelope zones */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        {defs.map(def => {
                            const v = values[def.key] ?? def.neutral;
                            const zone = paramZone(def, v);
                            const valColor = zone === 'red' ? 'text-red-500' : zone === 'amber' ? 'text-amber-500' : 'text-accent-cyan';
                            const isTemp = def.unit === '°C';
                            const fmt = (x: number) => (isTemp ? formatTempDelta(x, tempUnit) : def.format(x));
                            return (
                                <div key={def.key} title={def.note}>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="flex items-center gap-1.5">
                                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">{def.label}</label>
                                            {isTemp && (
                                                <button onClick={toggleTempUnit} title="Toggle °C / °F display (physics stays in °C deltas)"
                                                    className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors">
                                                    °{tempUnit === 'C' ? 'C→F' : 'F→C'}
                                                </button>
                                            )}
                                        </span>
                                        <span className={`text-sm font-mono font-bold ${valColor}`}>{fmt(v)}</span>
                                    </div>
                                    <input
                                        type="range" min={def.min * 100} max={def.max * 100} step={def.step * 100} value={v * 100}
                                        onChange={e => setValue(def.key, Number(e.target.value) / 100)}
                                        className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                                    />
                                    <div className="flex justify-between text-[10px] text-brand-600 mt-1">
                                        <span>{fmt(def.min)}</span>
                                        <span className="text-slate-300 truncate px-2" >{def.note.split('—')[0].trim()}</span>
                                        <span>{fmt(def.max)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Economics & assumptions */}
                    <div className="border border-slate-200 rounded-lg">
                        <button onClick={() => setEconOpen(!econOpen)} className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors">
                            <Factory size={14} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Economics & assumptions</span>
                            <span className="text-[10px] text-slate-400 ml-1">
                                {hasProduction
                                    ? `${econ.productionRate.toLocaleString()} ${econ.productionUnit}/day · $${econ.marginPerUnit}/${econ.productionUnit} margin`
                                    : 'set production rate & margin to see production impact'}
                            </span>
                            {econOpen ? <ChevronUp size={14} className="ml-auto text-slate-400" /> : <ChevronDown size={14} className="ml-auto text-slate-400" />}
                        </button>
                        {econOpen && (
                            <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-slate-100 pt-3">
                                {econNum('Production rate (/day)', 'productionRate', 10)}
                                <label className="block">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Unit</span>
                                    <select
                                        value={PRODUCTION_UNITS.some(g => g.units.includes(econ.productionUnit)) ? econ.productionUnit : '__custom__'}
                                        onChange={e => { if (e.target.value !== '__custom__') setEconField('productionUnit', e.target.value); }}
                                        className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                                    >
                                        {PRODUCTION_UNITS.map(g => (
                                            <optgroup key={g.group} label={g.group}>
                                                {g.units.map(u => <option key={u} value={u}>{u}/day</option>)}
                                            </optgroup>
                                        ))}
                                        <option value="__custom__">custom…</option>
                                    </select>
                                    {!PRODUCTION_UNITS.some(g => g.units.includes(econ.productionUnit)) && (
                                        <input value={econ.productionUnit} onChange={e => setEconField('productionUnit', e.target.value)}
                                            className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="your unit, e.g. pallets" />
                                    )}
                                </label>
                                {econNum('Margin per unit', 'marginPerUnit', 1, '$')}
                                {econNum('Cost per failure', 'costPerFailure', 500, '$')}
                                {econNum('Cost per PM', 'pmCost', 100, '$')}
                                {econNum('MTTR (hours)', 'mttrHours', 1)}
                                <label className="block col-span-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PM effectiveness — {econ.pmEffectivenessPct}%</span>
                                    <input type="range" min={50} max={100} step={5} value={econ.pmEffectivenessPct}
                                        onChange={e => setEconField('pmEffectivenessPct', Number(e.target.value))}
                                        className="mt-2 w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-accent-cyan" />
                                    <span className="text-[10px] text-slate-400">imperfect maintenance: only this share of PMs truly renews (stretches the effective interval)</span>
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={handleRun}
                            disabled={isRunning}
                            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition-all shadow-[0_0_20px_rgba(168,85,247,0.2)]"
                        >
                            {isRunning ? (
                                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{hasFit ? 'Running Monte Carlo…' : 'Computing estimate…'}</>
                            ) : (
                                <><Play size={14} /> {hasFit ? 'Run Simulation' : 'Estimate Impact'}</>
                            )}
                        </button>
                        <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg text-sm transition-colors">
                            <RotateCcw size={14} /> Reset
                        </button>
                        {defs.some(d => paramZone(d, values[d.key] ?? d.neutral) !== 'ok') && (
                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                                <AlertTriangle size={12} />
                                {defs.some(d => paramZone(d, values[d.key] ?? d.neutral) === 'red')
                                    ? 'Outside validated duty envelope — results are extrapolation'
                                    : 'Approaching duty envelope limits'}
                            </span>
                        )}
                    </div>

                    {/* Results */}
                    {result && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            {/* Reliability comparison */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <CompareCard icon={<Activity size={14} className="text-slate-400" />} label="Availability"
                                    base={result.baseline.metrics.availability_pct} proj={result.projected.metrics.availability_pct}
                                    delta={result.projected.metrics.availability_pct - result.baseline.metrics.availability_pct}
                                    unit="%" fmt={v => `${v.toFixed(1)}%`} />
                                <CompareCard icon={<Clock size={14} className="text-slate-400" />} label="MTBF"
                                    base={result.baseline.metrics.mtbf_days} proj={result.projected.metrics.mtbf_days}
                                    delta={result.projected.metrics.mtbf_days - result.baseline.metrics.mtbf_days}
                                    unit=" days" digits={0} fmt={v => `${v.toFixed(0)}d`} />
                                <CompareCard icon={<DollarSign size={14} className="text-slate-400" />} label="Maint. Cost"
                                    base={result.baseline.metrics.annual_cost_usd} proj={result.projected.metrics.annual_cost_usd}
                                    delta={result.projected.metrics.annual_cost_usd - result.baseline.metrics.annual_cost_usd}
                                    unit="$" invert fmt={v => `$${(v / 1000).toFixed(0)}k`} />
                                <CompareCard icon={<Shield size={14} className="text-slate-400" />} label="P(Failure) 1yr"
                                    base={result.baseline.metrics.failure_probability_1yr * 100} proj={result.projected.metrics.failure_probability_1yr * 100}
                                    delta={(result.projected.metrics.failure_probability_1yr - result.baseline.metrics.failure_probability_1yr) * 100}
                                    unit="%" invert fmt={v => `${v.toFixed(0)}%`} />
                            </div>

                            {/* ── Financial impact ── */}
                            <div className="border border-slate-200 rounded-lg p-4 bg-gradient-to-br from-emerald-50/40 to-white">
                                <div className="flex items-center gap-2 mb-3">
                                    <DollarSign size={14} className="text-emerald-600" />
                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Financial impact — all-in annual</span>
                                    {result.extrapolated && (
                                        <span className="text-[10px] font-semibold text-red-500">(extrapolated duty — treat with caution)</span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <CompareCard icon={<Clock size={14} className="text-slate-400" />} label="Downtime"
                                        base={result.baseline.financials.downtimeHours} proj={result.projected.financials.downtimeHours}
                                        delta={fin!.dDowntime} unit=" h" invert fmt={v => `${v.toFixed(0)}h`} />
                                    {hasProduction ? (
                                        <>
                                            <CompareCard icon={<Factory size={14} className="text-slate-400" />} label={`Lost production (${econ.productionUnit})`}
                                                base={result.baseline.financials.lostProductionUnits} proj={result.projected.financials.lostProductionUnits}
                                                delta={fin!.dLostUnits} unit={` ${econ.productionUnit}`} invert digits={0} fmt={v => `${Math.round(v).toLocaleString()}`} />
                                            <CompareCard icon={<DollarSign size={14} className="text-slate-400" />} label="Production value lost"
                                                base={result.baseline.financials.lostProductionValue} proj={result.projected.financials.lostProductionValue}
                                                delta={fin!.dLostValue} unit="$" invert fmt={v => `$${(v / 1000).toFixed(0)}k`} />
                                        </>
                                    ) : (
                                        <div className="col-span-2 border border-dashed border-slate-300 rounded-lg p-3 text-center flex flex-col justify-center">
                                            <p className="text-xs font-medium text-slate-500">Production impact not configured</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">Set production rate & margin under Economics to see {`bbl/$`} gained</p>
                                        </div>
                                    )}
                                    <div className={`rounded-lg p-3 border-2 ${result.netAnnualBenefit >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Net annual benefit</p>
                                        <p className={`text-2xl font-bold tabular-nums ${result.netAnnualBenefit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                            {result.netAnnualBenefit >= 0 ? '+' : '−'}${Math.abs(result.netAnnualBenefit).toLocaleString()}
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">vs baseline · maintenance + lost production</p>
                                    </div>
                                </div>
                            </div>

                            {/* Recommendation */}
                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Cpu size={14} className="text-blue-400" />
                                    <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">
                                        {result.runs ? 'Recommendation — simulated' : 'Recommendation — illustrative'}
                                    </span>
                                    <span className="text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 ml-auto">
                                        {result.runs ? `${result.runs.toLocaleString()} runs` : 'estimate'}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-700 leading-relaxed">{result.recommendation}</p>
                                {result.runs ? (
                                    <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                        Assumptions: baseline = neutral duty at 180d PM, same economics; duty physics per the {cls} model (cited on each slider);
                                        imperfect PM stretches the renewal interval by 1/effectiveness; MTTR {econ.mttrHours}h lognormal;
                                        failure ${econ.costPerFailure.toLocaleString()} / PM ${econ.pmCost.toLocaleString()}.
                                    </p>
                                ) : (
                                    <p className="text-[10px] text-slate-400 mt-2">Illustrative only — no fitted life model on this asset yet; numbers are directional.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
