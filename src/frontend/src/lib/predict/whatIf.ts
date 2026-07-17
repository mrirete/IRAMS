/**
 * What-If scenario engine (Phase 6 extension) — class-aware duty parameters,
 * imperfect PM, and financial impact, feeding the real Monte Carlo engine.
 *
 * Principles:
 *  - CLASS-AWARE: a static cooler gets corrosivity, not a bearing cube law.
 *  - CITED PHYSICS: every parameter's life-effect names its rule of thumb.
 *  - ENVELOPE HONESTY: values beyond the validated duty range are flagged as
 *    extrapolation (amber/red zones), never silently trusted.
 *  - MONEY: downtime hours are simulated per run — production loss and net
 *    benefit derive from them, not from a made-up availability constant.
 */
import type { PredictEquipmentClass } from './equipmentClass';
import type { GroundedRul } from './groundedFit';
import { runMonteCarloSimulation } from '../../eam/utils/monteCarloEngine';
import type { ScenarioMetrics } from '../../types/intelligence';

export const MC_RUNS = 2000;
export const MISSION_HOURS = 8760;

// ─── Class-aware duty parameters ─────────────────────────────

export interface WhatIfParamDef {
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
    /** neutral value — the baseline scenario runs at these */
    neutral: number;
    /** envelope zones: beyond amber = caution, beyond red = extrapolation */
    amberAbove?: number;
    redAbove?: number;
    /** multiplier applied to η for a value (1 at neutral) */
    etaFactor?: (v: number) => number;
    format: (v: number) => string;
    /** the cited rule behind the life-effect */
    note: string;
}

const PM_INTERVAL: WhatIfParamDef = {
    key: 'pmInterval', label: 'PM interval', unit: 'd',
    min: 30, max: 365, step: 15, neutral: 180,
    format: v => `${v}d`,
    note: 'Renewal interval passed to the simulation (imperfect PM stretches it).',
};

const PARAMS: Record<PredictEquipmentClass, WhatIfParamDef[]> = {
    rotating: [
        PM_INTERVAL,
        {
            key: 'load', label: 'Load factor', unit: '×',
            min: 0.5, max: 1.5, step: 0.05, neutral: 1.0,
            amberAbove: 1.1, redAbove: 1.25,
            etaFactor: v => 1 / Math.pow(Math.max(0.1, v), 3),
            format: v => `${v.toFixed(2)}×`,
            note: 'ISO 281 cube law — rolling-bearing life ∝ 1/L³ (ball; rollers ~10/3). Applies when failures are load-driven.',
        },
        {
            // Δ vs the asset's NORMAL duty (not absolute temperature) — a furnace
            // at 400 °C absolute is baseline; +100 here means 100° hotter than usual.
            key: 'tempDelta', label: 'Temp Δ', unit: '°C',
            min: -20, max: 100, step: 5, neutral: 0,
            amberAbove: 20, redAbove: 40,
            etaFactor: v => Math.pow(2, -v / 10),
            format: v => `${v > 0 ? '+' : ''}${v}°C`,
            note: 'Arrhenius rule of thumb — lubricant/insulation life halves per +10 °C above normal duty.',
        },
    ],
    static: [
        PM_INTERVAL,
        {
            key: 'corrosivity', label: 'Process corrosivity', unit: '×',
            min: 0.5, max: 3.0, step: 0.1, neutral: 1.0,
            amberAbove: 1.5, redAbove: 2.0,
            etaFactor: v => 1 / Math.max(0.1, v),
            format: v => `${v.toFixed(1)}×`,
            note: 'Failure intensity scales with corrosion attack — 2× corrosivity ≈ half the life (API 570 rate scaling).',
        },
        {
            key: 'tempDelta', label: 'Process temp Δ', unit: '°C',
            min: -20, max: 100, step: 5, neutral: 0,
            amberAbove: 25, redAbove: 50,
            etaFactor: v => Math.pow(2, -v / 25),
            format: v => `${v > 0 ? '+' : ''}${v}°C`,
            note: 'Corrosion-rate Arrhenius rule of thumb — attack roughly doubles per +25 °C above normal duty.',
        },
    ],
    electrical: [
        PM_INTERVAL,
        {
            key: 'loadCurrent', label: 'Load current', unit: '×',
            min: 0.5, max: 1.3, step: 0.05, neutral: 1.0,
            amberAbove: 1.05, redAbove: 1.15,
            etaFactor: v => 1 / Math.pow(Math.max(0.1, v), 2),
            format: v => `${v.toFixed(2)}×`,
            note: 'I²R heating — hotspot rise scales with current squared.',
        },
        {
            key: 'tempDelta', label: 'Ambient Δ', unit: '°C',
            min: -20, max: 40, step: 5, neutral: 0,
            amberAbove: 15, redAbove: 30,
            etaFactor: v => Math.pow(2, -v / 10),
            format: v => `${v > 0 ? '+' : ''}${v}°C`,
            note: 'IEEE/IEC insulation aging — life halves per +10 °C hotspot (Montsinger).',
        },
    ],
    instrument: [
        PM_INTERVAL,
        {
            key: 'tempDelta', label: 'Ambient Δ', unit: '°C',
            min: -20, max: 40, step: 5, neutral: 0,
            amberAbove: 20, redAbove: 35,
            etaFactor: v => Math.pow(2, -v / 15),
            format: v => `${v > 0 ? '+' : ''}${v}°C`,
            note: 'Generic electronics derating rule of thumb.',
        },
    ],
    other: [
        PM_INTERVAL,
        {
            key: 'load', label: 'Load factor', unit: '×',
            min: 0.5, max: 1.5, step: 0.05, neutral: 1.0,
            amberAbove: 1.1, redAbove: 1.25,
            etaFactor: v => 1 / Math.pow(Math.max(0.1, v), 3),
            format: v => `${v.toFixed(2)}×`,
            note: 'ISO 281 cube law (generic assumption — set Asset Class for class-specific physics).',
        },
        {
            key: 'tempDelta', label: 'Temp Δ', unit: '°C',
            min: -20, max: 100, step: 5, neutral: 0,
            amberAbove: 20, redAbove: 40,
            etaFactor: v => Math.pow(2, -v / 10),
            format: v => `${v > 0 ? '+' : ''}${v}°C`,
            note: 'Arrhenius 10 °C life-halving rule of thumb (Δ vs normal duty).',
        },
    ],
};

/** Common production units by industry — free text stays allowed. */
export const PRODUCTION_UNITS: { group: string; units: string[] }[] = [
    { group: 'Oil & Gas', units: ['bbl', 'm³', 'MMscf'] },
    { group: 'Mining', units: ['t', 'oz', 'loads'] },
    { group: 'Manufacturing', units: ['units', 'pieces', 'batches'] },
    { group: 'Power / Utilities', units: ['MWh', 'ML'] },
];

/** Display helper: temperature deltas in the user's preferred unit (physics stays °C). */
export function formatTempDelta(deltaC: number, unit: 'C' | 'F'): string {
    const v = unit === 'F' ? Math.round(deltaC * 1.8) : deltaC;
    return `${v > 0 ? '+' : ''}${v}°${unit}`;
}

export function whatIfParamsFor(cls: PredictEquipmentClass): WhatIfParamDef[] {
    return PARAMS[cls] ?? PARAMS.other;
}

export type ParamZone = 'ok' | 'amber' | 'red';
export function paramZone(def: WhatIfParamDef, v: number): ParamZone {
    if (def.redAbove != null && v > def.redAbove) return 'red';
    if (def.amberAbove != null && v > def.amberAbove) return 'amber';
    return 'ok';
}

// ─── Economics ───────────────────────────────────────────────

export interface EconomicInputs {
    /** production throughput attributable to this asset, units per day (0 = not set) */
    productionRate: number;
    /** unit label, e.g. bbl, t, MWh, units */
    productionUnit: string;
    /** contribution margin per unit, $ */
    marginPerUnit: number;
    costPerFailure: number;
    pmCost: number;
    mttrHours: number;
    /** imperfect maintenance: % of PMs that actually renew (Kijima-style
     *  approximation — effective renewal interval = interval / effectiveness) */
    pmEffectivenessPct: number;
}

export const DEFAULT_ECON: EconomicInputs = {
    productionRate: 0, productionUnit: 'bbl', marginPerUnit: 0,
    costPerFailure: 10000, pmCost: 1500, mttrHours: 8, pmEffectivenessPct: 100,
};

export interface ScenarioFinancials {
    downtimeHours: number;
    failuresPerYear: number;
    maintenanceCost: number;
    lostProductionUnits: number;
    lostProductionValue: number;
    /** maintenance + lost production */
    totalAnnualCost: number;
}

// ─── Runner ──────────────────────────────────────────────────

export interface WhatIfScenarioResult {
    metrics: ScenarioMetrics;
    financials: ScenarioFinancials;
}

function financialsFrom(downtimeHours: number, failures: number, maintenanceCost: number, econ: EconomicInputs): ScenarioFinancials {
    const lostUnits = econ.productionRate > 0 ? (downtimeHours / 24) * econ.productionRate : 0;
    const lostValue = lostUnits * (econ.marginPerUnit || 0);
    return {
        downtimeHours: Math.round(downtimeHours * 10) / 10,
        failuresPerYear: Math.round(failures * 10) / 10,
        maintenanceCost: Math.round(maintenanceCost),
        lostProductionUnits: Math.round(lostUnits * 10) / 10,
        lostProductionValue: Math.round(lostValue),
        totalAnnualCost: Math.round(maintenanceCost + lostValue),
    };
}

function runOne(
    fit: GroundedRul, defs: WhatIfParamDef[], values: Record<string, number>, econ: EconomicInputs,
): WhatIfScenarioResult {
    // η adjusted by every class parameter's cited life-effect.
    let eta = fit.eta!;
    for (const d of defs) {
        if (d.etaFactor) eta *= d.etaFactor(values[d.key] ?? d.neutral);
    }
    // Imperfect PM: only `effectiveness` of PMs renew → effective interval stretches.
    const eff = Math.min(1, Math.max(0.3, (econ.pmEffectivenessPct || 100) / 100));
    const pmIntervalH = ((values.pmInterval ?? 180) * 24) / eff;

    const out = runMonteCarloSimulation({
        beta: fit.beta!,
        eta,
        muR: Math.log(Math.max(0.5, econ.mttrHours)),
        sigmaR: 0.6,
        missionTime: MISSION_HOURS,
        numRuns: MC_RUNS,
        costPerFailure: econ.costPerFailure,
        pmCost: econ.pmCost,
        pmInterval: pmIntervalH,
        pmDuration: 4,
    });
    const runs = out.pmRuns.length ? out.pmRuns : out.rtfRuns;
    const p = out.pmPercentiles ?? out.rtfPercentiles;
    const pFail = runs.filter(r => r.failures > 0).length / (runs.length || 1);
    const se = Math.sqrt(Math.max(pFail * (1 - pFail), 1e-9) / (runs.length || 1));

    const metrics: ScenarioMetrics = {
        availability_pct: p.ao.p50,
        mtbf_days: Math.round(p.mtbfSim / 24),
        annual_cost_usd: p.cost.p50,
        failure_probability_1yr: Math.round(pFail * 1000) / 1000,
        confidence_interval: [
            Math.max(0, Math.round((pFail - 1.96 * se) * 1000) / 1000),
            Math.min(1, Math.round((pFail + 1.96 * se) * 1000) / 1000),
        ],
    };
    return { metrics, financials: financialsFrom(p.downtime.p50, p.failures.p50, p.cost.p50, econ) };
}

/**
 * Simulate the NEXT 12 months at CURRENT duty (all parameters neutral) —
 * the forward-looking half of the KPI Outlook (measured vs simulated).
 */
export function simulateCurrentDuty(
    fit: GroundedRul,
    cls: PredictEquipmentClass,
    econ: EconomicInputs,
): WhatIfScenarioResult {
    const defs = whatIfParamsFor(cls);
    return runOne(fit, defs, Object.fromEntries(defs.map(d => [d.key, d.neutral])), econ);
}

export interface WhatIfComparison {
    baseline: WhatIfScenarioResult;
    projected: WhatIfScenarioResult;
    /** projected total annual cost vs baseline: negative = the change SAVES money */
    netAnnualBenefit: number;
    /** any projected parameter sits in the red extrapolation zone */
    extrapolated: boolean;
    runs: number;
}

export function runWhatIfComparison(
    fit: GroundedRul,
    cls: PredictEquipmentClass,
    values: Record<string, number>,
    econ: EconomicInputs,
): WhatIfComparison {
    const defs = whatIfParamsFor(cls);
    const neutralValues = Object.fromEntries(defs.map(d => [d.key, d.neutral]));
    // Baseline = neutral duty at the default PM interval, same economics.
    const baseline = runOne(fit, defs, neutralValues, econ);
    const projected = runOne(fit, defs, values, econ);
    const extrapolated = defs.some(d => paramZone(d, values[d.key] ?? d.neutral) === 'red');
    return {
        baseline,
        projected,
        netAnnualBenefit: baseline.financials.totalAnnualCost - projected.financials.totalAnnualCost,
        extrapolated,
        runs: MC_RUNS,
    };
}
