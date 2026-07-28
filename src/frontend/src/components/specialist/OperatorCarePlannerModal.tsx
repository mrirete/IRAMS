/**
 * OperatorCarePlannerModal — TPM operator-care route planning (Phase F1).
 *
 * Groups the assets that want eyes on them (banded measurement points +
 * condition-based strategy verdicts) into walkable per-area routes, and
 * drafts each route into the proposals queue as a governed recurring-work
 * proposal — approve → deliver like everything else. Honest empty state
 * until measurement points exist: operator care starts with something to
 * check.
 */
import React, { useMemo, useState } from 'react';
import {
    X, Footprints, Check, SendHorizonal, Loader2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { predictionService } from '../../eam/services/PredictionService';
import { planCareRoutes, type RouteCandidate } from '../../lib/careRoutes';
import type { Assessment } from '../../eam/services/assessmentEngine';

export const OperatorCarePlannerModal: React.FC<{
    open: boolean;
    onClose: () => void;
    assessment: Assessment | null;
}> = ({ open, onClose, assessment }) => {
    const { user } = useAuth();
    const [drafting, setDrafting] = useState<string | null>(null);
    const [drafted, setDrafted] = useState<Set<string>>(new Set());

    const routes: RouteCandidate[] = useMemo(() => {
        if (!assessment) return [];
        const rows = assessment.assetIndex.map((x) => ({
            id: x.id, tag: x.tag, name: x.name,
            parent_id: assessment.parentByAsset[x.id] ?? null,
            criticality: x.criticality,
        }));
        return planCareRoutes(rows, assessment.strategy.verdicts, new Map(Object.entries(assessment.pointCountByAsset)));
    }, [assessment]);

    if (!open) return null;

    const draft = async (r: RouteCandidate) => {
        setDrafting(r.areaId);
        try {
            const created = await predictionService.createAgentAction({
                agent_type: 'strategy_engine' as never,
                trigger_id: 'care-planner',
                asset_id: r.areaId === '(unassigned)' ? (r.assets[0]?.id ?? null) as never : r.areaId as never,
                action_type: 'draft_pm_interval' as never,
                status: 'pending_review' as never,
                draft_payload: {
                    asset_id: r.areaId === '(unassigned)' ? r.assets[0]?.id ?? null : r.areaId,
                    asset_tag: r.areaTag,
                    recommendation_type: 'set_interval',
                    recommended_interval_days: r.suggestedIntervalDays,
                    basis: `Operator-care (CIL) route for ${r.areaTag} ${r.areaName}: walk ${r.assets.length} asset(s) — ${r.assets.map((a) => a.tag).join(', ')} — checking ${r.pointCount} banded point(s); clean, inspect, lubricate, record readings. Cadence ${r.suggestedIntervalDays === 7 ? 'weekly (criticality-A on the route)' : 'fortnightly'}.`,
                    current_pm_code: null,
                    route_kind: 'operator_care',
                    created_by: user?.username ?? user?.id ?? 'care-planner',
                },
            });
            if (created) setDrafted((s) => new Set(s).add(r.areaId));
        } finally {
            setDrafting(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 border border-sky-100 flex items-center justify-center"><Footprints size={16} /></span>
                        <div>
                            <h2 className="text-[15px] font-semibold text-slate-900">Operator-care route planner</h2>
                            <p className="text-[11.5px] text-slate-400">Clean-inspect-lubricate routes built from the assets that want eyes on them — TPM autonomous maintenance, drafted for approval.</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {routes.length === 0 ? (
                        <p className="text-center text-sm text-slate-400 py-14 px-8 leading-relaxed">
                            No route candidates yet — an operator-care route needs something to check.
                            Band measurement points on your worst actors (Condition Data), or let the strategy engine
                            mark assets condition-based, and routes assemble themselves here.
                        </p>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {routes.map((r) => (
                                <li key={r.areaId} className="px-5 py-4 flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13.5px] font-semibold text-slate-800">
                                            <span className="font-mono text-primary-700">{r.areaTag}</span>
                                            <span className="text-slate-400 font-normal"> · {r.areaName}</span>
                                        </div>
                                        <div className="mt-1 text-[11.5px] text-slate-500">
                                            {r.assets.length} asset{r.assets.length === 1 ? '' : 's'} · {r.pointCount} banded point{r.pointCount === 1 ? '' : 's'} ·
                                            suggested {r.suggestedIntervalDays === 7 ? 'weekly' : 'fortnightly'}
                                        </div>
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {r.assets.slice(0, 8).map((asst) => (
                                                <span key={asst.id} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600">
                                                    {asst.tag}{asst.criticality ? ` · ${asst.criticality}` : ''}{asst.pointCount ? ` · ${asst.pointCount}pt` : ''}{asst.cbmVerdict ? ' · CBM' : ''}
                                                </span>
                                            ))}
                                            {r.assets.length > 8 && <span className="text-[10.5px] text-slate-400">+{r.assets.length - 8} more</span>}
                                        </div>
                                    </div>
                                    <div className="shrink-0">
                                        {drafted.has(r.areaId) ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Check size={12} /> Queued</span>
                                        ) : (
                                            <button onClick={() => void draft(r)} disabled={drafting !== null}
                                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-primary-300 hover:text-primary-700 text-slate-600 text-[11px] font-semibold px-2 h-7 disabled:opacity-45 transition-colors">
                                                {drafting === r.areaId ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />} Draft route
                                            </button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-slate-100 text-[10.5px] text-slate-400 shrink-0">
                    Routes draft into the proposals queue as recurring-work candidates — a human approves before anything is scheduled.
                    Abnormality found on a route becomes a work request; readings recorded feed the Golden-Spot layer.
                </div>
            </div>
        </div>
    );
};

export default OperatorCarePlannerModal;
