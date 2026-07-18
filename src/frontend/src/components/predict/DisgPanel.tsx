/**
 * D-I-S-G curve panel (PSC framework) — Design → Installation → Success →
 * Golden Spot: the asset's success-side life story with the forward look.
 * Every readout is labelled by its basis (register / fitted β / measured
 * replay / drift projection); nothing renders without the data behind it.
 */
import React, { useEffect, useState } from 'react';
import { Compass, Loader2 } from 'lucide-react';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { assessDisg, MIN_DRIFT_POINTS, type DisgAssessment } from '../../lib/predict/disg';
import type { GroundedRul } from '../../lib/predict/groundedFit';

interface Props {
    assetId: string;
    assetName: string;
    groundedFit?: GroundedRul | null;
}

const fmtH = (h: number | null | undefined) => {
    if (h == null) return '—';
    if (h < 48) return `${Math.round(h)}h`;
    return `${Math.round(h / 24)}d`;
};

export const DisgPanel: React.FC<Props> = ({ assetId, assetName, groundedFit }) => {
    const [loading, setLoading] = useState(true);
    const [disg, setDisg] = useState<DisgAssessment | null>(null);
    const [bandedCount, setBandedCount] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        (async () => {
            try {
                const db = DatabaseService.getInstance();
                const [defs, logs] = await Promise.all([db.getReadingDefinitions(assetId), db.getReadingLogs(assetId)]);
                if (!active) return;
                const params = (defs || []).map((d: any) => ({
                    id: d.id, name: d.name,
                    minWarning: d.minWarning, maxWarning: d.maxWarning,
                    minCritical: d.minCritical, maxCritical: d.maxCritical,
                }));
                setBandedCount(params.filter((p: any) => [p.minWarning, p.maxWarning, p.minCritical, p.maxCritical].some((v: any) => v != null)).length);
                const readings = (logs || []).filter((l: any) => l.isActive !== false).map((l: any) => ({
                    paramId: l.definitionId,
                    at: `${l.date}T${(l.time || '00:00').slice(0, 5)}:00`,
                    value: Number(l.value),
                }));
                setDisg(assessDisg(params, readings, { fittedBeta: groundedFit?.beta ?? null }));
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [assetId, groundedFit?.beta]);

    const phases: { key: string; title: string; value: string; sub: string; tone: 'ok' | 'warn' | 'idle' }[] = disg ? [
        {
            key: 'D', title: 'Design',
            value: 'Register',
            sub: 'design data & SMEA monitorability — see Decide · RCM',
            tone: 'idle',
        },
        {
            key: 'I', title: 'Installation',
            value: disg.installSignal
                ? (disg.installSignal.infantMortality ? `β=${disg.installSignal.beta}` : `β=${disg.installSignal.beta} ✓`)
                : '—',
            sub: disg.installSignal
                ? (disg.installSignal.infantMortality
                    ? 'infant-mortality signature — investigate install/commissioning (RCA)'
                    : 'no early-life defect signature in the fitted life data')
                : 'needs fitted failure history',
            tone: disg.installSignal?.infantMortality ? 'warn' : disg.installSignal ? 'ok' : 'idle',
        },
        {
            key: 'S', title: 'Success',
            value: disg.timeToSuccessHours != null ? (disg.timeToSuccessHours === 0 ? 'Immediate' : fmtH(disg.timeToSuccessHours)) : '—',
            sub: disg.timeToSuccessHours != null
                ? (disg.timeToSuccessHours === 0 ? 'entered the Golden Spot at first observation' : 'time from first observation to Golden Spot entry')
                : (disg.zoneNow === 'UNKNOWN' ? 'needs banded readings' : 'never observed in the Golden Spot yet — S-phase incomplete'),
            tone: disg.timeToSuccessHours != null ? 'ok' : 'warn',
        },
        {
            key: 'G', title: 'Golden Spot',
            value: disg.currentStreakHours != null ? `${fmtH(disg.currentStreakHours)} in spot` : disg.zoneNow.replace(/_/g, ' ').toLowerCase(),
            sub: disg.predictedRemainingInSpotHours != null
                ? `projected departure in ${fmtH(disg.predictedRemainingInSpotHours)} — limiting: ${disg.limitingParam}`
                : disg.drifts.some(d => d.status === 'projecting' || d.status === 'stable')
                    ? 'no measurable drift toward a band — holding'
                    : `drift projection needs ≥${MIN_DRIFT_POINTS} readings per parameter`,
            tone: disg.predictedRemainingInSpotHours != null && disg.predictedRemainingInSpotHours < 30 * 24 ? 'warn' : 'ok',
        },
    ] : [];

    const TONE = {
        ok: 'border-emerald-200 bg-emerald-50/50',
        warn: 'border-amber-300 bg-amber-50',
        idle: 'border-slate-200 bg-slate-50/50',
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
                <Compass size={18} className="text-primary-500" />
                <h3 className="text-base font-semibold text-slate-800">D-I-S-G Curve — success trajectory</h3>
                <span className="text-[10px] font-normal text-slate-400 ml-auto">{assetName}</span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Design → Installation → Success → Golden Spot (PSC framework) — the success-side mirror of the
                P-F curve: design & installation quality decide how fast the asset reaches stable operation,
                then the question becomes how long it HOLDS the Golden Spot.
            </p>

            {loading ? (
                <div className="py-6 text-center text-slate-400"><Loader2 size={16} className="inline animate-spin mr-2" />Assessing…</div>
            ) : bandedCount === 0 ? (
                <div className="border border-dashed border-slate-300 rounded-lg p-5 text-center">
                    <p className="text-sm font-medium text-slate-500">No Golden Spot defined yet</p>
                    <p className="text-xs text-slate-400 mt-1">Add measurement points with warning bands (Condition Data) — the bands ARE the Golden Spot.</p>
                </div>
            ) : (
                <>
                    {/* Phase stepper */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {phases.map((p, i) => (
                            <div key={p.key} className={`relative border rounded-lg p-3 ${TONE[p.tone]}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="w-5 h-5 rounded-full bg-white border border-slate-300 text-[10px] font-bold text-slate-600 flex items-center justify-center">{p.key}</span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{p.title}</span>
                                    {i < 3 && <span className="hidden md:block absolute -right-2.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs z-10">→</span>}
                                </div>
                                <p className="text-sm font-bold text-slate-800 truncate">{p.value}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{p.sub}</p>
                            </div>
                        ))}
                    </div>

                    {/* Predicted success metrics */}
                    {(disg?.predictedMtopHours != null || disg?.predictedSuccessRate != null) && (
                        <div className="mt-3 flex items-center gap-4 flex-wrap px-3 py-2 bg-primary-50/50 border border-primary-100 rounded-lg">
                            <span className="text-[10px] font-bold text-primary-700 uppercase tracking-wider">Forecast (drift projection)</span>
                            <span className="text-xs text-slate-600">Predicted MTOP: <strong className="tabular-nums">{fmtH(disg.predictedMtopHours)}</strong></span>
                            {disg.predictedSuccessRate != null && (
                                <span className="text-xs text-slate-600">Predicted SR: <strong className="tabular-nums">{disg.predictedSuccessRate}%</strong></span>
                            )}
                            <span className="text-[10px] text-slate-400">current streak + time to worst band-crossing; SR uses measured MTTRg</span>
                        </div>
                    )}

                    {/* Drift table */}
                    {disg && disg.drifts.length > 0 && (
                        <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                            <div className="grid grid-cols-[1.3fr_1fr_0.6fr_1fr] gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <span>Parameter</span><span>Drift</span><span>R²</span><span>Band crossing</span>
                            </div>
                            {disg.drifts.map(d => (
                                <div key={d.paramId} className="grid grid-cols-[1.3fr_1fr_0.6fr_1fr] gap-2 px-3 py-1.5 border-b border-slate-100 last:border-b-0 text-xs">
                                    <span className="font-medium text-slate-700 truncate">{d.paramName}</span>
                                    <span className="tabular-nums text-slate-600">
                                        {d.status === 'insufficient' ? `${d.n}/${MIN_DRIFT_POINTS} readings` : `${(d.slopePerHour * 24).toPrecision(2)}/day`}
                                    </span>
                                    <span className="tabular-nums text-slate-500">{d.status === 'insufficient' ? '—' : d.r2.toFixed(2)}</span>
                                    <span className={d.status === 'projecting' ? (d.hoursToDeparture! < 30 * 24 ? 'text-amber-600 font-semibold' : 'text-slate-600') : 'text-slate-400'}>
                                        {d.status === 'projecting' ? `~${fmtH(d.hoursToDeparture)} → ${d.targetBand}`
                                            : d.status === 'outside' ? 'outside band now'
                                                : d.status === 'noisy' ? 'trend too noisy'
                                                    : d.status === 'stable' ? 'stable / improving'
                                                        : 'insufficient data'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
