import React, { useState, useEffect } from 'react';
import { X, FileText, GitMerge, ShieldAlert, Loader2 } from 'lucide-react';
import type { ParetoResult } from '../../eam/services/AnalyzeService';
import analyzeService from '../../eam/services/AnalyzeService';

// ── Types ────────────────────────────────────────────────────
interface WorkOrderRow {
    id: string;
    wo_number: string;
    type: string;
    status: string;
    failure_mode: string | null;
    total_cost: number;
    created_at: string;
}

interface AssetDrillDrawerProps {
    asset: ParetoResult;
    criteria: 'cost' | 'downtime' | 'wo_frequency';
    onClose: () => void;
    onInitiateRCA: (asset: ParetoResult) => void;
    onCreateFMEA: (asset: ParetoResult) => void;
}

// ── Component ────────────────────────────────────────────────
export const AssetDrillDrawer: React.FC<AssetDrillDrawerProps> = ({
    asset,
    criteria,
    onClose,
    onInitiateRCA,
    onCreateFMEA,
}) => {
    const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
    const [woLoading, setWoLoading] = useState(true);

    // ── Fetch contributing WOs on mount ──────────────────────
    useEffect(() => {
        let cancelled = false;
        const fetch = async () => {
            setWoLoading(true);
            try {
                const data = await analyzeService.getAssetWorkOrders(asset.asset_id);
                if (!cancelled) setWorkOrders(data);
            } catch (e) {
                console.error('[AssetDrillDrawer] WO fetch error:', e);
            } finally {
                if (!cancelled) setWoLoading(false);
            }
        };
        fetch();
        return () => { cancelled = true; };
    }, [asset.asset_id]);

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-white border-l border-slate-200 shadow-2xl h-full overflow-y-auto animate-in slide-in-from-right duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Drawer Header */}
                <div className="p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[10px] font-bold ${asset.criticality === 'A' ? 'bg-red-500/20 text-red-400' : asset.criticality === 'B' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                                    {asset.criticality}
                                </span>
                                <h2 className="text-lg font-bold text-slate-800">{asset.asset_tag}</h2>
                                <span className="text-xs text-slate-400 capitalize bg-slate-50 px-2 py-0.5 rounded">{asset.hierarchy_level.toLowerCase()}</span>
                            </div>
                            <p className="text-sm text-slate-500">{asset.asset_name}</p>
                        </div>
                        <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Metrics Summary */}
                <div className="p-5 grid grid-cols-3 gap-3 border-b border-slate-200">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Rank</p>
                        <p className="text-2xl font-bold text-accent-cyan mt-1">#{asset.rank}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{criteria === 'cost' ? 'Total Cost' : criteria === 'downtime' ? 'Downtime' : 'WO Count'}</p>
                        <p className="text-2xl font-bold text-slate-800 mt-1">
                            {asset.metric_unit === '$' ? '$' : ''}{asset.metric_value.toLocaleString()}{asset.metric_unit !== '$' ? ` ${asset.metric_unit}` : ''}
                        </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Work Orders</p>
                        <p className="text-2xl font-bold text-primary-400 mt-1">{asset.event_count}</p>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="p-5 border-b border-slate-200">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-3">Quick Actions</p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onInitiateRCA(asset)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-medium transition-colors border border-red-500/20"
                        >
                            <GitMerge size={14} /> Initiate RCA
                        </button>
                        <button
                            onClick={() => onCreateFMEA(asset)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 rounded-lg text-xs font-medium transition-colors border border-yellow-500/20"
                        >
                            <ShieldAlert size={14} /> Create FMEA
                        </button>
                    </div>
                </div>

                {/* Contributing Work Orders — live data */}
                <div className="p-5">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-3">Contributing Work Orders</p>
                    {woLoading ? (
                        <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-sm">
                            <Loader2 size={16} className="animate-spin" /> Loading work orders…
                        </div>
                    ) : workOrders.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 text-sm">
                            <FileText className="mx-auto mb-3 opacity-40" size={28} />
                            <p>No work orders found for this asset.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider">
                                        <th className="p-2 text-left">WO#</th>
                                        <th className="p-2 text-left">Type</th>
                                        <th className="p-2 text-left">Status</th>
                                        <th className="p-2 text-left">Failure Mode</th>
                                        <th className="p-2 text-right">Cost</th>
                                        <th className="p-2 text-right">Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {workOrders.map(wo => (
                                        <tr key={wo.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                                            <td className="p-2 font-mono text-accent-cyan">{wo.wo_number}</td>
                                            <td className="p-2 text-slate-600">{wo.type}</td>
                                            <td className="p-2">
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${wo.status === 'CLOSED' || wo.status === 'TECO' ? 'bg-green-500/10 text-green-400' : 'bg-slate-100 text-slate-600'}`}>
                                                    {wo.status}
                                                </span>
                                            </td>
                                            <td className="p-2 text-slate-500 truncate max-w-[120px]">{wo.failure_mode || '—'}</td>
                                            <td className="p-2 text-right font-mono text-slate-700">${wo.total_cost.toLocaleString()}</td>
                                            <td className="p-2 text-right text-slate-400">{new Date(wo.created_at).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AssetDrillDrawer;
