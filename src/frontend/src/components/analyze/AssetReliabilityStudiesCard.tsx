/**
 * AssetReliabilityStudiesCard — the asset-centric reliability dossier.
 *
 * Surfaces everything Reliability Modelling knows about ONE asset — saved
 * studies, latest fits, and the PM programs they produced — inside the asset
 * detail view. This is the SAP-style object-centric readout: start from the
 * equipment, see its analysis history, jump into the lab with context.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FlaskConical, TrendingUp, Wrench, ArrowUpRight, ArrowRight } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { ReliabilityAnalysis } from '../../eam/services/AnalyzeService';

interface Props {
    asset: { id: string; tag?: string; name?: string; criticality?: string };
}

const TYPE_LABELS: Record<string, string> = {
    weibull: 'Weibull',
    mtbf: 'RAM / MTBF',
    montecarlo: 'Monte Carlo',
    spares: 'Spares',
    availability: 'Availability',
    maintainability: 'Maintainability',
};

export const AssetReliabilityStudiesCard: React.FC<Props> = ({ asset }) => {
    const navigate = useNavigate();
    const [analyses, setAnalyses] = useState<ReliabilityAnalysis[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        analyzeService.getReliabilityAnalyses(asset.id).then(rows => {
            if (!alive) return;
            setAnalyses(rows);
            setLoading(false);
        });
        return () => { alive = false; };
    }, [asset.id]);

    // Latest version per lineage, newest first
    const current = useMemo(() => {
        const byRoot = new Map<string, ReliabilityAnalysis>();
        for (const a of analyses) {
            const root = a.root_id || a.id;
            const cur = byRoot.get(root);
            if (!cur || (a.version || 1) > (cur.version || 1)) byRoot.set(root, a);
        }
        return Array.from(byRoot.values())
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }, [analyses]);

    const linkedPMs = current.filter(a => a.linked_pm_id);

    const openModelling = (tab: 'weibull' | 'ram' | 'montecarlo' | 'spares' | 'rbd' = 'weibull') =>
        navigate('/reliability-modelling', {
            state: {
                seed: {
                    asset: { id: asset.id, name: asset.name || '', tag: asset.tag || '', criticality: asset.criticality || 'C' },
                    tab,
                },
            },
        });

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    <FlaskConical size={15} className="text-primary-500" />
                    Reliability Studies
                    {current.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">{current.length}</span>
                    )}
                </div>
                <button
                    onClick={() => openModelling('weibull')}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
                >
                    Open Modelling <ArrowRight size={11} />
                </button>
            </div>

            {loading ? (
                <div className="px-4 py-5 text-xs text-slate-400 animate-pulse">Loading studies…</div>
            ) : current.length === 0 ? (
                <div className="px-4 py-5 text-center">
                    <p className="text-xs text-slate-500 font-medium">No reliability studies for this asset yet</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                        Fit a Weibull curve from its work-order history to characterise the failure pattern.
                    </p>
                    <button
                        onClick={() => openModelling('weibull')}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                    >
                        <TrendingUp size={12} /> Fit Weibull from history
                    </button>
                </div>
            ) : (
                <div className="divide-y divide-slate-50">
                    {current.slice(0, 5).map(a => {
                        const r = a.results || {};
                        const summary = a.analysis_type === 'weibull' && r.beta
                            ? `β=${Number(r.beta).toFixed(2)} · η=${Math.round(Number(r.eta || 0)).toLocaleString()}h`
                            : a.analysis_type === 'spares' && r.requiredSpares != null
                                ? `${r.requiredSpares} spares recommended`
                                : r.ao ? `Ao ${(Number(r.ao) * 100).toFixed(1)}%` : null;
                        return (
                            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded shrink-0">
                                    {TYPE_LABELS[a.analysis_type] || a.analysis_type}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-700 truncate">{a.title}</p>
                                    <p className="text-[10px] text-slate-400">
                                        {summary ? `${summary} · ` : ''}{new Date(a.updated_at).toLocaleDateString()}
                                        {(a.version || 1) > 1 ? ` · v${a.version}` : ''}
                                    </p>
                                </div>
                                {a.linked_pm_id && (
                                    <Link
                                        to={`/recurring-work?q=${a.linked_pm_id}`}
                                        title={`PM program: ${a.linked_pm_title || a.linked_pm_id}`}
                                        className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-100 transition-colors"
                                    >
                                        <Wrench size={10} /> PM <ArrowUpRight size={9} />
                                    </Link>
                                )}
                            </div>
                        );
                    })}
                    {linkedPMs.length === 0 && (
                        <div className="px-4 py-2 bg-amber-50/50 text-[10px] text-amber-700">
                            Studies exist but none has produced a PM program yet — open a Weibull fit and use "Create PM Program".
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AssetReliabilityStudiesCard;
