/**
 * Reliability — "Start here" band.
 *
 * The launcher's first click. Instead of dropping the user into a blank asset
 * picker on a calculator they have not heard of, this reads the canonical
 * reliability view (sem_asset_reliability — 12 months of corrective work) and
 * says which assets are actually worth studying, and which model their data
 * can carry.
 *
 * Honesty contract:
 *   - The ranking is lost hours, then failure count. Both come from real WOs.
 *   - Every row states its readiness. An asset with too few failures is shown
 *     with what it is short of — it is NOT offered a life fit it cannot support
 *     (the launcher half of audit finding M-1: a 0-failure asset used to reach
 *     the Weibull tab and inherit the illustrative dataset).
 *   - Downtime that was never recorded is printed as "not recorded", never 0 h.
 */
import React, { useEffect, useState } from 'react';
import { ArrowRight, Compass, Loader2, AlertTriangle, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../eam/lib/supabase';

/** A life fit needs enough events for the median-rank regression to mean anything. */
export const MIN_FOR_LIFE_FIT = 5;
/** MTBF / availability need at least a couple of intervals. */
export const MIN_FOR_BASELINE = 2;

export interface StartCandidate {
    id: string;
    tag: string;
    name: string;
    criticality: string;
    failures: number;
    downtimeHrs: number;
    downtimeCoveragePct: number;
    mtbfHours: number | null;
    availabilityPct: number | null;
}

type Readiness = {
    tone: 'ready' | 'partial' | 'thin';
    label: string;
    detail: string;
    tool: 'weibull' | 'ram' | null;
    action: string;
};

export function readinessOf(c: StartCandidate): Readiness {
    if (c.failures >= MIN_FOR_LIFE_FIT) {
        return {
            tone: 'ready',
            label: 'Ready for a life fit',
            detail: 'Enough history to fit a failure pattern and set a replacement age',
            tool: 'weibull',
            action: 'Find its replacement age',
        };
    }
    if (c.failures >= MIN_FOR_BASELINE) {
        return {
            tone: 'partial',
            label: 'Baseline only',
            detail: `Enough for MTBF and availability; a life fit needs ${MIN_FOR_LIFE_FIT} failures (${c.failures} so far)`,
            tool: 'ram',
            action: 'Set its baseline',
        };
    }
    return {
        tone: 'thin',
        label: 'Not enough history',
        detail: 'Nothing to model until more corrective work is closed against it',
        tool: null,
        action: '',
    };
}

const TONE_CLS: Record<Readiness['tone'], string> = {
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    thin: 'bg-slate-100 text-slate-500 border-slate-200',
};

// Same A/B/C dot the Asset Register uses, so criticality reads identically
// wherever the asset appears (older tenants carry CRITICAL/HIGH/MEDIUM words).
const CRIT_CLS: Record<string, string> = {
    A: 'bg-red-500', CRITICAL: 'bg-red-500',
    B: 'bg-orange-500', HIGH: 'bg-orange-500',
    C: 'bg-blue-500', MEDIUM: 'bg-blue-500',
    D: 'bg-slate-400', LOW: 'bg-slate-400',
};

interface Props {
    /** Open a tool with this asset already selected. */
    onStart: (tool: 'weibull' | 'ram', asset: { id: string; tag: string; name: string; criticality: string }) => void;
    /** How many candidates to show (default 4 — a shortlist, not a report). */
    limit?: number;
}

export const ReliabilityStartHere: React.FC<Props> = ({ onStart, limit = 4 }) => {
    const navigate = useNavigate();
    const [rows, setRows] = useState<StartCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            // Canonical per-asset reliability (0234a) — the same numbers Metrics
            // and Reports show, so the shortlist cannot disagree with them.
            const { data, error } = await supabase
                .from('sem_asset_reliability')
                .select('asset_id, asset_tag, criticality, failures_12mo, downtime_hrs_12mo, downtime_coverage_pct, mtbf_hours, availability_pct')
                .gt('failures_12mo', 0)
                .order('downtime_hrs_12mo', { ascending: false })
                .order('failures_12mo', { ascending: false })
                .limit(50);

            if (cancelled) return;
            if (error) { setFailed(true); setLoading(false); return; }

            const top = (data || []).slice(0, limit);
            const ids = top.map((r: any) => r.asset_id).filter(Boolean);
            const names: Record<string, string> = {};
            if (ids.length > 0) {
                const { data: assets } = await supabase.from('assets').select('id, name').in('id', ids);
                for (const a of assets || []) names[(a as any).id] = (a as any).name;
            }
            if (cancelled) return;

            setRows(top.map((r: any) => ({
                id: r.asset_id,
                tag: r.asset_tag || '—',
                name: names[r.asset_id] || r.asset_tag || 'Unnamed asset',
                criticality: (r.criticality || '').toUpperCase(),
                failures: Number(r.failures_12mo) || 0,
                downtimeHrs: Number(r.downtime_hrs_12mo) || 0,
                downtimeCoveragePct: Number(r.downtime_coverage_pct) || 0,
                mtbfHours: r.mtbf_hours != null ? Number(r.mtbf_hours) : null,
                availabilityPct: r.availability_pct != null ? Number(r.availability_pct) : null,
            })));
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [limit]);

    if (failed) return null;   // never block the page on the shortlist

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 border-b border-slate-100">
                <span className="flex items-center gap-2 shrink-0">
                    <Compass size={15} className="text-primary-500" />
                    <h2 className="text-sm font-bold text-slate-800 whitespace-nowrap">Start here</h2>
                </span>
                <span className="text-[11px] text-slate-400">— what your failure history says is worth studying</span>
                <span className="w-full sm:w-auto sm:ml-auto text-[10px] text-slate-400">Ranked by hours lost · last 12 months of corrective work</span>
            </div>

            {loading && (
                <div className="px-4 py-6 flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={14} className="animate-spin" /> Reading your failure history…
                </div>
            )}

            {!loading && rows.length === 0 && (
                <div className="px-4 py-6">
                    <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                            <AlertTriangle size={16} />
                        </span>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-700">No failure history to model yet</p>
                            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                Every model on this page is built from your corrective work orders — a failure needs a date,
                                a closed work order and, for downtime maths, the hours the asset was down. Once that work is
                                being recorded, the assets worth studying appear here automatically.
                            </p>
                            <div className="flex flex-wrap gap-2 mt-3">
                                <button
                                    onClick={() => navigate('/failure-review')}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-600 transition-colors"
                                >
                                    <ClipboardList size={13} /> Code failures in Failure Review
                                </button>
                                <button
                                    onClick={() => navigate('/work-orders')}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-600 transition-colors"
                                >
                                    Open work orders <ArrowRight size={13} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {!loading && rows.length > 0 && (
                <ul className="divide-y divide-slate-100">
                    {rows.map(c => {
                        const r = readinessOf(c);
                        const startable = r.tool !== null;
                        return (
                            <li key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 hover:bg-slate-50/70 transition-colors">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{c.tag}</span>
                                        <span className="text-sm font-semibold text-slate-800 truncate">{c.name}</span>
                                        {c.criticality && (
                                            <span
                                                title={`Criticality ${c.criticality}`}
                                                className={`text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center text-white shrink-0 ${CRIT_CLS[c.criticality] || 'bg-slate-400'}`}
                                            >
                                                {c.criticality.charAt(0)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-1">
                                        <strong className="text-slate-600">{c.failures}</strong> failure{c.failures === 1 ? '' : 's'}
                                        {' · '}
                                        {c.downtimeHrs > 0
                                            ? <><strong className="text-slate-600">{c.downtimeHrs.toLocaleString()} h</strong> down</>
                                            : <span className="text-slate-400">downtime not recorded</span>}
                                        {c.mtbfHours != null && <> · fails about every <strong className="text-slate-600">{Math.round(c.mtbfHours / 24).toLocaleString()} days</strong></>}
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">{r.detail}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${TONE_CLS[r.tone]}`}>{r.label}</span>
                                    {startable && (
                                        <button
                                            onClick={() => onStart(r.tool!, { id: c.id, tag: c.tag, name: c.name, criticality: c.criticality })}
                                            className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold shadow-sm hover:bg-primary-700 transition-colors"
                                        >
                                            {r.action}
                                            <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default ReliabilityStartHere;
