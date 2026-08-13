/**
 * TroubleMakers + SystemHotspots — Systems-Thinking Phase 2
 * (docs/Systems-Thinking-Failure-Analysis-Plan.md).
 *
 * Trouble Makers: which asset causes damage BEYOND itself — built from the
 * secondary-failure links recorded at closeout (0289). The per-asset bad-actor
 * Pareto charges the victims; this ranking charges the cause.
 *
 * System Hotspots: the same failure record rolled up to SYSTEM-level
 * hierarchy nodes via rpc_pareto_analysis (0079/0290) — the manager's Pareto
 * reads "Lube-oil system", not five asset rows hiding one problem.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Network, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ReportChartCard } from './ReportChartCard';

interface InitiatorRow {
    asset_id: string;
    asset_tag: string;
    asset_name: string;
    criticality: string | null;
    collateral_events_12mo: number;
    victim_assets: number;
    collateral_downtime_hrs_12mo: number;
    collateral_cost_12mo: number;
    own_failures_12mo: number;
    own_downtime_hrs_12mo: number;
}

export const TroubleMakersCard: React.FC = () => {
    const navigate = useNavigate();
    const [rows, setRows] = useState<InitiatorRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        supabase
            .from('sem_cascade_initiators')
            .select('*')
            .limit(200)
            .then(({ data }) => {
                if (!active) return;
                const sorted = ((data || []) as InitiatorRow[])
                    .sort((a, b) =>
                        (Number(b.collateral_downtime_hrs_12mo) + Number(b.own_downtime_hrs_12mo)) -
                        (Number(a.collateral_downtime_hrs_12mo) + Number(a.own_downtime_hrs_12mo)))
                    .slice(0, 10);
                setRows(sorted);
                setLoading(false);
            });
        return () => { active = false; };
    }, []);

    return (
        <ReportChartCard
            title="Trouble Makers"
            subtitle="Assets whose failures damaged OTHER assets (collateral links, last 12 months)"
            height={rows.length > 0 ? Math.max(180, 64 + rows.length * 44) : 160}
        >
            {loading ? (
                <div className="flex items-center justify-center h-full text-slate-400 text-sm gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <Zap size={22} className="text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500 font-medium">No collateral links recorded yet.</p>
                    <p className="text-xs text-slate-400 mt-1">
                        When closing a corrective work order, answer <em>"Was this caused by another failure?"</em> —
                        the initiators will rank here, charged with the damage they cause beyond themselves.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto h-full">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                                <th className="px-2 py-2 text-left font-semibold">Initiator</th>
                                <th className="px-2 py-2 text-right font-semibold">Own failures</th>
                                <th className="px-2 py-2 text-right font-semibold">Collateral events</th>
                                <th className="px-2 py-2 text-right font-semibold">Victim assets</th>
                                <th className="px-2 py-2 text-right font-semibold">Downtime caused</th>
                                <th className="px-2 py-2 text-right font-semibold">Cost caused</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr
                                    key={r.asset_id}
                                    onClick={() => navigate(`/assets?id=${r.asset_id}`)}
                                    className="border-b border-slate-100 hover:bg-amber-50/40 cursor-pointer"
                                >
                                    <td className="px-2 py-2">
                                        <span className="font-mono font-bold text-slate-700">{r.asset_tag}</span>
                                        <span className="text-slate-500 ml-1.5">{r.asset_name}</span>
                                        {r.criticality === 'A' && <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">CRIT A</span>}
                                    </td>
                                    <td className="px-2 py-2 text-right text-slate-600">{r.own_failures_12mo}</td>
                                    <td className="px-2 py-2 text-right font-bold text-amber-700">{r.collateral_events_12mo}</td>
                                    <td className="px-2 py-2 text-right text-slate-600">{r.victim_assets}</td>
                                    <td className="px-2 py-2 text-right font-semibold text-slate-700">
                                        {(Number(r.own_downtime_hrs_12mo) + Number(r.collateral_downtime_hrs_12mo)).toFixed(1)}h
                                        <span className="text-[10px] text-amber-600 ml-1">({Number(r.collateral_downtime_hrs_12mo).toFixed(1)}h collateral)</span>
                                    </td>
                                    <td className="px-2 py-2 text-right font-semibold text-slate-700">
                                        {Number(r.collateral_cost_12mo) > 0 ? `$${Math.round(Number(r.collateral_cost_12mo)).toLocaleString()}` : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </ReportChartCard>
    );
};

interface HotspotRow {
    asset_id: string;
    asset_tag: string;
    asset_name: string;
    metric_value: number;
    metric_unit: string;
    event_count: number;
    pct_of_total: number;
}

export const SystemHotspotsCard: React.FC = () => {
    const navigate = useNavigate();
    const [rows, setRows] = useState<HotspotRow[]>([]);
    const [criteria, setCriteria] = useState<'downtime' | 'cost' | 'wo_frequency'>('downtime');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        setLoading(true);
        supabase
            .rpc('rpc_pareto_analysis', {
                p_hierarchy_level: 'SYSTEM',
                p_criteria: criteria,
                p_wo_types: ['CM', 'EM', 'BM', 'CORRECTIVE'],
                p_limit: 8,
            })
            .then(({ data, error }) => {
                if (!active) return;
                if (error) console.warn('[SystemHotspots] rpc failed:', error.message);
                setRows((data || []) as HotspotRow[]);
                setLoading(false);
            });
        return () => { active = false; };
    }, [criteria]);

    const maxVal = rows.length ? Number(rows[0].metric_value) : 0;
    const label = criteria === 'downtime' ? 'corrective downtime' : criteria === 'cost' ? 'corrective cost' : 'failures';

    return (
        <ReportChartCard
            title="System Hotspots"
            subtitle="Corrective work rolled up to SYSTEM level — manage systems, not tags"
            height={Math.max(200, 96 + rows.length * 40)}
        >
            <div className="flex items-center gap-1 mb-2">
                {(['downtime', 'cost', 'wo_frequency'] as const).map(c => (
                    <button
                        key={c}
                        onClick={() => setCriteria(c)}
                        className={`px-2 py-1 text-[10px] font-bold rounded-md border ${criteria === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                    >
                        {c === 'downtime' ? 'Downtime' : c === 'cost' ? 'Cost' : 'Failures'}
                    </button>
                ))}
            </div>
            {loading ? (
                <div className="flex items-center justify-center h-24 text-slate-400 text-sm gap-2"><Loader2 size={15} className="animate-spin" /> Rolling up…</div>
            ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 text-center px-6">
                    <Network size={20} className="text-slate-300 mb-1.5" />
                    <p className="text-xs text-slate-400">No corrective {label} attributable to SYSTEM-level nodes yet.</p>
                </div>
            ) : (
                <div className="space-y-1.5">
                    {rows.map(r => (
                        <button
                            key={r.asset_id}
                            onClick={() => navigate(`/assets?id=${r.asset_id}`)}
                            className="w-full text-left group"
                        >
                            <div className="flex items-center justify-between text-xs mb-0.5">
                                <span className="min-w-0 truncate">
                                    <span className="font-mono font-bold text-slate-700 group-hover:text-blue-700">{r.asset_tag}</span>
                                    <span className="text-slate-500 ml-1.5">{r.asset_name}</span>
                                </span>
                                <span className="font-semibold text-slate-700 flex-shrink-0 ml-2">
                                    {criteria === 'cost' ? `$${Math.round(Number(r.metric_value)).toLocaleString()}` : `${Number(r.metric_value).toLocaleString()}${criteria === 'downtime' ? 'h' : ''}`}
                                    <span className="text-[10px] text-slate-400 ml-1">({r.event_count} WOs)</span>
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-blue-500 group-hover:bg-blue-600 transition-all"
                                    style={{ width: `${maxVal > 0 ? Math.max(3, (Number(r.metric_value) / maxVal) * 100) : 0}%` }}
                                />
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </ReportChartCard>
    );
};
