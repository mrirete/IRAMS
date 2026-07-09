/**
 * PSCPanel — Potential Success Curve metrics for the Measure module.
 *
 * The success-centric complement to the failure-centric SMRP KPIs above it:
 * Golden Spot zone now, MTOP, MTTRg and Success Rate per Olorunfemi (2026),
 * "A Success-Centric Evolution of Reliability-Centered Maintenance in Modern
 * Asset Management". An asset's Golden Spot is defined by the optimal bands of
 * its condition reading points; readings drive the zone timeline. Honest by
 * construction: metrics appear only where banded reading points AND logged
 * readings exist — nothing is simulated.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Star, TrendingUp, Timer, RotateCcw, Loader2, Info } from 'lucide-react';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { computePSC, PSC_TARGETS, isBanded, type GoldenSpotParam, type ParamReading, type PSCResult } from '../../lib/psc';

interface AssetLite { id: string; tag: string; name: string; }

const ZONE_STYLE: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
    GOLDEN_SPOT: { label: 'In Golden Spot', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', icon: <Star size={12} className="fill-emerald-500 text-emerald-500" /> },
    SUB_OPTIMAL_DRIFT: { label: 'Sub-Optimal Drift', cls: 'bg-amber-50 text-amber-700 border-amber-300' },
    CRITICAL_DEPARTURE: { label: 'Critical Departure', cls: 'bg-rose-50 text-rose-700 border-rose-300' },
    UNKNOWN: { label: 'No condition data', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

const fmtH = (h: number | null) => h === null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`;

export const PSCPanel: React.FC = () => {
    const [assets, setAssets] = useState<AssetLite[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [windowDays, setWindowDays] = useState(90);
    const [loading, setLoading] = useState(true);
    const [result, setResult] = useState<PSCResult | null>(null);
    const [params, setParams] = useState<GoldenSpotParam[]>([]);

    // Assets that actually have banded reading points (Golden Spot candidates).
    useEffect(() => {
        (async () => {
            const db = DatabaseService.getInstance();
            const [defs, allAssets] = await Promise.all([db.getReadingDefinitions(), db.getAssets()]);
            const bandedAssetIds = new Set(
                (defs as any[])
                    .filter(d => isBanded({ id: d.id, name: d.name, minWarning: d.minWarning, maxWarning: d.maxWarning, minCritical: d.minCritical, maxCritical: d.maxCritical }))
                    .map(d => d.assetId),
            );
            const list = (allAssets as any[])
                .filter(a => bandedAssetIds.has(a.id))
                .map(a => ({ id: a.id, tag: a.tag, name: a.name }))
                .sort((a, b) => a.tag.localeCompare(b.tag));
            setAssets(list);
            if (list.length && !selectedId) setSelectedId(list[0].id);
            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Compute PSC for the selected asset.
    useEffect(() => {
        if (!selectedId) { setResult(null); return; }
        let cancelled = false;
        (async () => {
            const db = DatabaseService.getInstance();
            const [defs, logs] = await Promise.all([db.getReadingDefinitions(selectedId), db.getReadingLogs(selectedId)]);
            const gsParams: GoldenSpotParam[] = (defs as any[]).map(d => ({
                id: d.id, name: d.name,
                minWarning: d.minWarning, maxWarning: d.maxWarning,
                minCritical: d.minCritical, maxCritical: d.maxCritical,
            }));
            const readings: ParamReading[] = (logs as any[])
                .filter(l => l.definitionId && l.value !== null && l.value !== undefined)
                .map(l => ({
                    paramId: l.definitionId,
                    at: `${l.date}T${l.time || '12:00:00'}`,
                    value: Number(l.value),
                }));
            if (!cancelled) {
                setParams(gsParams.filter(isBanded));
                setResult(computePSC(gsParams, readings, Date.now(), windowDays));
            }
        })();
        return () => { cancelled = true; };
    }, [selectedId, windowDays]);

    if (loading) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" /> Loading Potential Success Curve…
            </div>
        );
    }

    const zone = ZONE_STYLE[result?.zoneNow ?? 'UNKNOWN'];
    const sr = result?.successRate ?? null;
    const srBadge = sr === null ? null
        : sr >= PSC_TARGETS.srWorldClass ? { t: 'World-class ≥95%', c: 'bg-emerald-100 text-emerald-700' }
        : sr >= PSC_TARGETS.srTarget ? { t: 'On target ≥90%', c: 'bg-blue-100 text-blue-700' }
        : { t: 'Below 90% target', c: 'bg-amber-100 text-amber-700' };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 md:p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-600"><Star size={15} /></span>
                    <div>
                        <h3 className="text-sm sm:text-base font-extrabold text-slate-900">Potential Success Curve</h3>
                        <p className="text-[11px] text-slate-400">Success-centric metrics — how long assets SUSTAIN optimal performance, not just how often they fail.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
                        className="px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-700 max-w-[220px]">
                        {assets.length === 0 && <option value="">No assets with banded reading points</option>}
                        {assets.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                    </select>
                    <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}
                        className="px-2 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-700">
                        {[30, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
                    </select>
                </div>
            </div>

            {assets.length === 0 ? (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <span>
                        Define a Golden Spot first: give an asset condition reading points with optimal bands
                        (min/max warning) under <strong>Work Management → Condition Data</strong>. The PSC metrics
                        compute automatically once readings are logged against those bands.
                    </span>
                </div>
            ) : result && (
                <>
                    <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Zone now */}
                        <div className={`rounded-xl border p-3.5 ${zone.cls}`}>
                            <div className="text-[10px] font-extrabold uppercase tracking-wider opacity-70 mb-1">Zone now</div>
                            <div className="text-sm font-extrabold flex items-center gap-1.5">{zone.icon}{zone.label}</div>
                            {result.currentDepartureHours !== null && (
                                <div className="text-[10px] font-semibold mt-1 opacity-80">departed {fmtH(result.currentDepartureHours)} ago</div>
                            )}
                            {result.zoneNow === 'GOLDEN_SPOT' && result.lastRestoredAt && (
                                <div className="text-[10px] font-semibold mt-1 opacity-80">restored {fmtH((Date.now() - result.lastRestoredAt) / 3_600_000)} ago</div>
                            )}
                        </div>
                        {/* MTOP */}
                        <div className="rounded-xl border border-slate-200 p-3.5">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><TrendingUp size={11} /> MTOP</div>
                            <div className="text-xl font-extrabold text-slate-900">{fmtH(result.mtopHours)}</div>
                            <div className="text-[10px] text-slate-400 font-medium">mean time of optimal performance · {result.inSpotPeriods} period{result.inSpotPeriods === 1 ? '' : 's'}</div>
                        </div>
                        {/* MTTRg */}
                        <div className="rounded-xl border border-slate-200 p-3.5">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><RotateCcw size={11} /> MTTRg</div>
                            <div className="text-xl font-extrabold text-slate-900">{fmtH(result.mttrgHours)}</div>
                            <div className="text-[10px] text-slate-400 font-medium">mean time to restore Golden Spot · {result.completedRestorations} restoration{result.completedRestorations === 1 ? '' : 's'}</div>
                        </div>
                        {/* Success Rate */}
                        <div className="rounded-xl border border-slate-200 p-3.5">
                            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Timer size={11} /> Success Rate</div>
                            <div className="text-xl font-extrabold text-slate-900">{sr === null ? '—' : `${sr.toFixed(1)}%`}</div>
                            {srBadge
                                ? <span className={`inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${srBadge.c}`}>{srBadge.t}</span>
                                : <div className="text-[10px] text-slate-400 font-medium">needs a completed departure-and-restoration cycle</div>}
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400 font-medium">
                        <span>{result.percentTimeInSpot !== null ? `${result.percentTimeInSpot.toFixed(1)}% of observed time in Golden Spot` : 'No observations in window'}</span>
                        <span>Golden Spot: {params.length} banded parameter{params.length === 1 ? '' : 's'}, {result.coverage.paramsWithData} with readings</span>
                        <span className="italic">Framework: Potential Success Curve — Olorunfemi (2026) · aligns to ISO 55000:2024 value & assurance outcomes</span>
                    </div>
                </>
            )}
        </div>
    );
};

export default PSCPanel;
