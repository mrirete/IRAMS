/**
 * OeeCalculator — the SMRP 2.1.1 / 2.1.2 what-if calculator, laid out on the
 * 7th-edition timeline (Guideline 2.0): Total Available Time → Idle Time →
 * Scheduled Hours → scheduled/unscheduled downtime → Uptime, then Performance
 * and first-pass Quality. It replaces the old demo tab that shipped three
 * fictitious assets in localStorage: this one starts on the standard's own
 * worked example (Machine D, Table 1) and every number on screen is derived
 * from what the user typed. Targets follow the 7th-edition bands by process
 * type; a performance leg above 100% is flagged, not hidden.
 */
import React, { useMemo, useState } from 'react';
import { Calculator, AlertTriangle, RotateCcw } from 'lucide-react';
import { computeOee7, SMRP_TABLE1_EXAMPLE, type Oee7Input } from '../../lib/oee7';
import { OEE_TARGETS, OEE_LEG_TARGETS, type ProcessType } from '../../lib/smrpCatalog';

interface Props {
    /** Seed the inputs from a measured period (compute_oee row) when available. */
    seed?: Partial<Oee7Input> & { label?: string };
    defaultProcessType?: ProcessType;
}

const FIELDS: { key: keyof Oee7Input; label: string; hint: string; step?: number }[] = [
    { key: 'totalAvailableHrs', label: 'Total Available Time (h)', hint: '24 h per day of the period (2.1.1)', step: 1 },
    { key: 'idleHrs', label: 'Idle Time (h)', hint: 'No demand, no feedstock, no raw material, administrative (2.4)', step: 0.1 },
    { key: 'scheduledDowntimeHrs', label: 'Scheduled Downtime (h)', hint: 'Work on the finalized weekly schedule incl. PM (3.3)', step: 0.01 },
    { key: 'unscheduledDowntimeHrs', label: 'Unscheduled Downtime (h)', hint: 'Breakdowns, setups, waiting, startup (3.4)', step: 0.01 },
    { key: 'bestRatePerHr', label: 'Best Production Rate (units/h)', hint: 'Design rate or demonstrated best sustained rate, whichever is higher', step: 0.1 },
    { key: 'actualProduction', label: 'Actual Production (units)', hint: 'All units produced, good and bad', step: 1 },
    { key: 'firstPassGood', label: 'First-pass Saleable (units)', hint: 'Met spec first time, no rework (Quality)', step: 1 },
];

const fmt = (v: number | null, suffix = '%') => (v == null ? '—' : `${v}${suffix}`);

export const OeeCalculator: React.FC<Props> = ({ seed, defaultProcessType = 'batch' }) => {
    const initial = useMemo<Oee7Input>(() => ({ ...SMRP_TABLE1_EXAMPLE, ...Object.fromEntries(Object.entries(seed || {}).filter(([k, v]) => k !== 'label' && v != null)) }), [seed]);
    const [input, setInput] = useState<Oee7Input>(initial);
    const [processType, setProcessType] = useState<ProcessType>(defaultProcessType);
    const r = useMemo(() => computeOee7(input), [input]);
    const target = OEE_TARGETS[processType];
    const legColor = (v: number | null, t: number) => v == null ? 'text-slate-400' : v >= t ? 'text-emerald-600' : v >= t - 15 ? 'text-amber-500' : 'text-red-500';

    // Timeline bar widths as % of TAT.
    const tat = Math.max(1, input.totalAvailableHrs);
    const w = (h: number) => `${Math.max(0, Math.min(100, (h / tat) * 100))}%`;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                <Calculator size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-slate-800">OEE Calculator</h3>
                <span className="text-[11px] text-slate-400">SMRP 2.1.1 · 2.1.2 TEEP · Guideline 2.0 timeline{seed?.label ? ` · seeded from ${seed.label}` : ' · seeded with the standard’s Table 1 example'}</span>
                <div className="ml-auto flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500 font-semibold">Process</span>
                    <select value={processType} onChange={e => setProcessType(e.target.value as ProcessType)}
                        className="px-2 py-1 border border-slate-200 rounded-lg bg-white text-slate-700 focus:ring-2 focus:ring-primary-200 outline-none">
                        {(Object.keys(OEE_TARGETS) as ProcessType[]).map(k => <option key={k} value={k}>{OEE_TARGETS[k].label} · {OEE_TARGETS[k].oee}%+</option>)}
                    </select>
                    <button onClick={() => setInput(initial)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 font-semibold ml-1" title="Reset inputs"><RotateCcw size={11} /> Reset</button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                {/* Inputs */}
                <div className="p-4 space-y-2.5">
                    {FIELDS.map(f => (
                        <label key={f.key} className="block" title={f.hint}>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{f.label}</span>
                            <input type="number" min={0} step={f.step ?? 1} value={input[f.key]}
                                onChange={e => setInput(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                                className="mt-0.5 w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-200 outline-none" />
                            <span className="text-[10px] text-slate-400">{f.hint}</span>
                        </label>
                    ))}
                </div>

                {/* Results + timeline */}
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                        {[
                            { label: 'Availability', v: r.availabilityPct, ref: '2.2', t: OEE_LEG_TARGETS.availability },
                            { label: 'Performance', v: r.performancePct, ref: '', t: OEE_LEG_TARGETS.performance, raw: r.performanceRawPct },
                            { label: 'Quality', v: r.qualityPct, ref: '', t: OEE_LEG_TARGETS.quality },
                            { label: 'OEE', v: r.oeePct, ref: '2.1.1', t: target.oee },
                            { label: 'TEEP', v: r.teepPct, ref: '2.1.2', t: target.oee },
                        ].map(c => (
                            <div key={c.label} className="rounded-lg border border-slate-200 p-2.5">
                                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{c.label}{c.ref && <span className="text-slate-300"> ·{c.ref}</span>}</div>
                                <div className={`text-xl font-extrabold mt-0.5 ${legColor(c.v, c.t)}`}>{fmt(c.v)}</div>
                                <div className="text-[10px] text-slate-400">target ≥ {c.t}%{c.raw != null && c.raw > 100 ? ` · raw ${c.raw}%` : ''}</div>
                            </div>
                        ))}
                    </div>

                    {/* Guideline 2.0 timeline */}
                    <div className="space-y-1.5 text-[10px]">
                        <div className="font-bold uppercase tracking-wide text-slate-400">Time elements (share of Total Available Time)</div>
                        <div className="flex h-5 rounded overflow-hidden border border-slate-200" title="Total Available Time">
                            <div className="bg-emerald-500" style={{ width: w(r.uptimeHrs) }} title={`Uptime ${r.uptimeHrs}h`} />
                            <div className="bg-red-400" style={{ width: w(r.losses.unscheduled) }} title={`Unscheduled downtime ${r.losses.unscheduled}h`} />
                            <div className="bg-orange-400" style={{ width: w(r.losses.scheduled) }} title={`Scheduled downtime ${r.losses.scheduled}h`} />
                            <div className="bg-slate-300" style={{ width: w(r.losses.idle) }} title={`Idle time ${r.losses.idle}h`} />
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-500">
                            <span><i className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Uptime {r.uptimeHrs}h ({fmt(r.uptimePct)} · 2.3)</span>
                            <span><i className="inline-block w-2 h-2 rounded-sm bg-red-400 mr-1" />Unscheduled {r.losses.unscheduled}h</span>
                            <span><i className="inline-block w-2 h-2 rounded-sm bg-orange-400 mr-1" />Scheduled {r.losses.scheduled}h</span>
                            <span><i className="inline-block w-2 h-2 rounded-sm bg-slate-300 mr-1" />Idle {r.losses.idle}h ({fmt(r.idlePct)} · 2.4)</span>
                            <span className="text-slate-400">Utilization {fmt(r.utilizationPct)} (2.5) · Total downtime {fmt(r.totalDowntimePct)} (3.2)</span>
                        </div>
                        <div className="text-slate-500">
                            Capacity-equivalent hours lost: speed {r.losses.speed}h · quality {r.losses.quality}h. OEE 1 looks at utilization and scheduling (idle + scheduled downtime); OEE 2 is A × P × Q while scheduled.
                        </div>
                    </div>

                    {r.warnings.length > 0 && (
                        <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                            <div>{r.warnings.map((m, i) => <div key={i}>{m}</div>)}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OeeCalculator;
