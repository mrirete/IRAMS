/**
 * KPI Outlook — the Measure → Forecast bridge (closes the reliability loop).
 *
 * Three honestly-labelled columns of truth:
 *   MEASURED   trailing-12-month SMRP KPIs (reliabilityMetrics — the same
 *              engine as the Metrics scoreboard) + the PSC success layer
 *              (MTOP / MTTRg / SR per Olorunfemi Eq. 1–3, from psc.ts)
 *   SIMULATED  next-12-month Monte Carlo at current duty (fitted Weibull)
 *   ASSUMED    PQ / EE factors the user supplies → OEE outlook and OPE
 *              (PSC Eq. 4: OPE = SR × PQ × EE) — flagged as assumptions
 *              until production/quality feeds exist.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { computeAssetReliability, FAILURE_QUERY_COLUMNS, isFailure } from '../../eam/services/reliabilityMetrics';
import { computePSC, type PSCResult } from '../../lib/psc';
import { simulateCurrentDuty, DEFAULT_ECON, MC_RUNS, type WhatIfScenarioResult } from '../../lib/predict/whatIf';
import type { GroundedRul } from '../../lib/predict/groundedFit';
import type { ClassResolution } from '../../lib/predict/equipmentClass';

interface Props {
    assetId: string;
    groundedFit?: GroundedRul | null;
    equipmentClass?: ClassResolution | null;
}

type Chip = 'measured' | 'simulated' | 'assumed' | 'none';
const CHIP_TONE: Record<Chip, string> = {
    measured: 'bg-blue-50 text-blue-700 border-blue-200',
    simulated: 'bg-primary-50 text-primary-700 border-primary-200',
    assumed: 'bg-amber-50 text-amber-700 border-amber-200',
    none: 'bg-slate-50 text-slate-400 border-slate-200',
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v.toFixed(d)}%`);

export const KpiOutlook: React.FC<Props> = ({ assetId, groundedFit, equipmentClass }) => {
    const hasFit = !!groundedFit && !!groundedFit.beta && !!groundedFit.eta;
    const [loading, setLoading] = useState(true);
    const [measured, setMeasured] = useState<ReturnType<typeof computeAssetReliability> | null>(null);
    const [failures12, setFailures12] = useState(0);
    const [psc, setPsc] = useState<PSCResult | null>(null);
    const [sim, setSim] = useState<WhatIfScenarioResult | null>(null);
    // PQ / EE assumptions, persisted per asset. 0 = not set → OEE/OPE stay "—".
    const [assume, setAssume] = useState<{ pq: number; ee: number }>(() => {
        try { return { pq: 0, ee: 0, ...JSON.parse(localStorage.getItem(`predict.outlook.${assetId}`) || '{}') }; }
        catch { return { pq: 0, ee: 0 }; }
    });
    useEffect(() => {
        try { localStorage.setItem(`predict.outlook.${assetId}`, JSON.stringify(assume)); } catch { /* ignore */ }
    }, [assetId, assume]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        (async () => {
            try {
                const db = DatabaseService.getInstance();
                const [woRes, defs, logs] = await Promise.all([
                    supabase.from('work_orders').select(FAILURE_QUERY_COLUMNS).eq('asset_id', assetId),
                    db.getReadingDefinitions(assetId),
                    db.getReadingLogs(assetId),
                ]);
                if (!active) return;
                let rows = woRes.data || [];
                // FAILURE_QUERY_COLUMNS can be ahead of the live schema (e.g. a
                // missing duration column 42703s the whole select) — fall back to
                // the minimal set the failure math needs; MTTR then shows "—".
                if (woRes.error) {
                    const fb = await supabase.from('work_orders')
                        .select('id, type, status, created_at, closed_at, wo_failure_data(failure_mode_code)')
                        .eq('asset_id', assetId);
                    rows = fb.data || [];
                }
                setMeasured(computeAssetReliability(rows));
                const yearAgo = Date.now() - 365 * 86400000;
                setFailures12(rows.filter(isFailure).filter((r: any) => {
                    const d = r.closed_at || r.created_at;
                    return d && new Date(d).getTime() >= yearAgo;
                }).length);
                // PSC success layer: Golden Spot = the points' warning/critical bands.
                setPsc(computePSC(
                    (defs || []).map((d: any) => ({
                        id: d.id, name: d.name,
                        minWarning: d.minWarning, maxWarning: d.maxWarning,
                        minCritical: d.minCritical, maxCritical: d.maxCritical,
                    })),
                    (logs || []).filter((l: any) => l.isActive !== false).map((l: any) => {
                        // reading_time may arrive as 'HH:MM' or 'HH:MM:SS' — normalize.
                        const t = (l.time || '00:00').length === 5 ? `${l.time || '00:00'}:00` : (l.time || '00:00:00');
                        return { paramId: l.definitionId, at: `${l.date}T${t}`, value: Number(l.value) };
                    }),
                    Date.now(), 365,
                ));
                // Forward simulation at current duty (fitted assets only).
                if (groundedFit?.beta && groundedFit?.eta) {
                    let econ = DEFAULT_ECON;
                    try { econ = { ...DEFAULT_ECON, ...JSON.parse(localStorage.getItem(`predict.whatif.${assetId}`) || '{}') }; } catch { /* ignore */ }
                    setSim(simulateCurrentDuty(groundedFit, equipmentClass?.cls ?? 'other', econ));
                } else {
                    setSim(null);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [assetId, groundedFit, equipmentClass?.cls]);

    // OEE outlook (availability-driven) and OPE (PSC Eq. 4) from the assumptions.
    const derived = useMemo(() => {
        const pq = assume.pq > 0 ? assume.pq / 100 : null;
        const ee = assume.ee > 0 ? assume.ee / 100 : null;
        const aoSim = sim?.metrics.availability_pct ?? null;
        const sr = psc?.successRate ?? null;
        return {
            oeeOutlook: aoSim != null && pq != null ? aoSim * pq : null,
            ope: sr != null && pq != null && ee != null ? sr * pq * ee : null,
        };
    }, [assume, sim, psc]);

    const Row = ({ label, meas, simv, chipMeas = 'measured', chipSim = 'simulated', note }: {
        label: string; meas: string; simv: string; chipMeas?: Chip; chipSim?: Chip; note?: string;
    }) => (
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 items-center px-3 py-2 border-b border-slate-100 last:border-b-0" title={note}>
            <span className="text-xs font-medium text-slate-600">{label}</span>
            <span className="flex items-center gap-1.5">
                <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border ${CHIP_TONE[meas === '—' ? 'none' : chipMeas]}`}>{chipMeas === 'assumed' ? 'asm' : 'meas'}</span>
                <span className="text-sm font-bold text-slate-800 tabular-nums">{meas}</span>
            </span>
            <span className="flex items-center gap-1.5">
                <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border ${CHIP_TONE[simv === '—' ? 'none' : chipSim]}`}>{chipSim === 'assumed' ? 'asm' : 'sim'}</span>
                <span className="text-sm font-bold text-slate-800 tabular-nums">{simv}</span>
            </span>
        </div>
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg text-blue-600 border border-blue-100"><BarChart3 size={18} /></div>
                <div className="flex-1">
                    <h3 className="text-base font-semibold text-slate-800">KPI Outlook</h3>
                    <p className="text-xs text-slate-400">
                        Trailing 12 months measured vs next 12 months simulated{hasFit ? ` (${MC_RUNS.toLocaleString()} Monte Carlo runs at current duty)` : ' — needs a fitted life model for the simulated column'}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="p-8 text-center text-slate-400"><Loader2 size={18} className="inline animate-spin mr-2" />Computing outlook…</div>
            ) : (
                <div className="grid md:grid-cols-2 gap-0 md:gap-4 p-4">
                    {/* ── SMRP failure-side KPIs ── */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Failure side (SMRP)</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Measured 12mo</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Next 12mo</span>
                        </div>
                        <Row label="MTBF" meas={measured?.mtbfDays != null ? `${Math.round(measured.mtbfDays)}d` : '—'} simv={sim ? `${sim.metrics.mtbf_days}d` : '—'} />
                        <Row label="MTTR" meas={measured?.mttrHours != null ? `${measured.mttrHours}h` : '—'} simv={sim ? `${DEFAULT_ECON.mttrHours}h` : '—'} chipSim="assumed" note="Simulated column assumes the Economics MTTR (repair times are not forecast)" />
                        <Row label="Availability" meas={pct(measured?.availabilityPct)} simv={sim ? pct(sim.metrics.availability_pct) : '—'} />
                        <Row label="Failures / yr" meas={String(failures12)} simv={sim ? String(sim.financials.failuresPerYear) : '—'} />
                        <Row label="Downtime / yr" meas="—" simv={sim ? `${Math.round(sim.financials.downtimeHours)}h` : '—'} note="Measured downtime rollup lives on the Metrics page" />
                    </div>

                    {/* ── PSC success layer + outlooks ── */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden mt-4 md:mt-0">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Success side (PSC)</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Measured 12mo</span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Outlook</span>
                        </div>
                        <Row label="MTOP — mean time in Golden Spot" meas={psc?.mtopHours != null ? `${Math.round(psc.mtopHours)}h` : '—'} simv="—" note="MTOP forecasting needs a drift model (D-I-S-G) — roadmap" />
                        <Row label="MTTRg — mean restoration" meas={psc?.mttrgHours != null ? `${Math.round(psc.mttrgHours)}h` : '—'} simv="—" />
                        <Row label="SR — success rate (Eq. 3)" meas={pct(psc?.successRate)} simv="—" />
                        <Row label="OEE outlook (Ao × PQ)" meas="—" simv={derived.oeeOutlook != null ? pct(derived.oeeOutlook) : '—'} chipSim="assumed" note="Simulated availability × your assumed PQ" />
                        <Row label="OPE (Eq. 4: SR × PQ × EE)" meas={derived.ope != null ? pct(derived.ope) : '—'} simv="—" chipMeas="assumed" note="Measured SR × assumed PQ × assumed EE — assumptions until production/quality feeds exist" />
                        <div className="px-3 py-2.5 bg-slate-50/60 border-t border-slate-100 flex items-center gap-3 flex-wrap">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Assumptions</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                PQ %
                                <input type="number" min={0} max={100} value={assume.pq || ''}
                                    onChange={e => setAssume(a => ({ ...a, pq: Number(e.target.value) }))}
                                    placeholder="—" className="w-16 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums" />
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                EE %
                                <input type="number" min={0} max={100} value={assume.ee || ''}
                                    onChange={e => setAssume(a => ({ ...a, ee: Number(e.target.value) }))}
                                    placeholder="—" className="w-16 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums" />
                            </label>
                            <span className="text-[10px] text-slate-400">performance-quality & energy-effectiveness factors (PSC paper, Eq. 4)</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
