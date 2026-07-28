/**
 * PmOptimizationModal — the fleet-wide PM review (Phase B3), as a pop-up on
 * the assessment's PM section (calm-screens pattern: process lives in the
 * popup, the page stays a report).
 *
 * Runs lib/pmOptimization over every ACTIVE programme and lets the user
 * draft any verdict into the proposals queue as a draft_pm_interval —
 * the same governed path the Weibull Analyst uses: pending review →
 * human approve → Deliver → measured value. Payload shapes match
 * lib/writebackPackage so approved drafts stay deliverable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    X, Loader2, Wrench, Check, SendHorizonal, Activity, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
    computePmOptimization, type PmOptimizationResult, type PmVerdict,
} from '../../lib/pmOptimization';

const VERDICT_META: Record<PmVerdict['verdict'], { label: string; cls: string }> = {
    redundant: { label: 'redundant', cls: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
    over_maintenance: { label: 'stretch', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
    under_maintenance: { label: 'tighten', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
    ineffective: { label: 'shift to CBM', cls: 'bg-sky-50 text-sky-600 border-sky-200' },
};

const RECOMMENDATION_TYPE: Record<PmVerdict['verdict'], string> = {
    over_maintenance: 'extend_interval',
    under_maintenance: 'set_interval',
    ineffective: 'condition_monitoring',
    redundant: 'set_interval',
};

export const PmOptimizationModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { user } = useAuth();
    const [result, setResult] = useState<PmOptimizationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [drafted, setDrafted] = useState<Set<string>>(new Set());
    const [drafting, setDrafting] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setResult(null); setError(null); setDrafted(new Set());
        (async () => {
            try {
                const [pmQ, woQ, assetQ] = await Promise.all([
                    supabase.from('recurring_work')
                        .select('id, code, title, asset_id, job_type, frequency_interval, frequency_unit')
                        .eq('active', true).limit(3000),
                    supabase.from('work_orders')
                        .select('asset_id, type, created_at')
                        .eq('type', 'CM')
                        .order('created_at', { ascending: false }).limit(20000),
                    supabase.from('assets').select('id, tag, name, criticality').limit(10000),
                ]);
                if (pmQ.error) throw pmQ.error;
                setResult(computePmOptimization(
                    (pmQ.data ?? []) as never,
                    (woQ.data ?? []) as never,
                    (assetQ.data ?? []) as never,
                    Date.now(),
                ));
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        })();
    }, [open]);

    const totals = useMemo(() => result === null ? null : ({
        flagged: result.verdicts.length,
        scanned: result.scanned,
        saved: result.eventsSavedPerYear,
    }), [result]);

    const draftOne = async (v: PmVerdict): Promise<boolean> => {
        const { error: err } = await supabase.from('ers_agent_actions').insert({
            agent_type: 'pm_optimizer',
            asset_id: v.assetId,
            action_type: 'draft_pm_interval',
            draft_payload: {
                asset_id: v.assetId,
                asset_tag: v.tag,
                recommendation_type: RECOMMENDATION_TYPE[v.verdict],
                recommended_interval_days: v.recommendedIntervalDays,
                basis: v.reason,
                current_pm_code: v.code,
                verdict: v.verdict,
                events_saved_per_year: v.eventsSavedPerYear,
                created_by: user?.username ?? user?.id ?? 'pm_optimizer',
            },
            status: 'pending_review',
        });
        return !err;
    };

    const draft = async (v: PmVerdict) => {
        setDrafting(v.pmId);
        try {
            if (await draftOne(v)) setDrafted((s) => new Set(s).add(v.pmId));
        } finally {
            setDrafting(null);
        }
    };

    const draftAll = async () => {
        if (!result) return;
        setDrafting('all');
        try {
            for (const v of result.verdicts) {
                if (drafted.has(v.pmId)) continue;
                if (await draftOne(v)) setDrafted((s) => new Set(s).add(v.pmId));
            }
        } finally {
            setDrafting(null);
        }
    };

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-4xl max-h-[85vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0"><Wrench size={16} /></span>
                        <div className="min-w-0">
                            <h2 className="text-[15px] font-semibold text-slate-900">Fleet-wide PM optimization</h2>
                            <p className="text-[11.5px] text-slate-400 truncate">
                                {totals
                                    ? <>{totals.scanned} active programmes reviewed · {totals.flagged} flagged · ~{totals.saved} PM events/yr recoverable</>
                                    : 'Reviewing every active programme against its failure history…'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {result && result.verdicts.length > 0 && (
                            <button onClick={() => void draftAll()} disabled={drafting !== null || drafted.size === result.verdicts.length}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[12px] font-semibold px-3 h-9 disabled:opacity-45 transition-colors">
                                {drafting === 'all' ? <Loader2 size={13} className="animate-spin" /> : <SendHorizonal size={13} />}
                                Draft all as proposals
                            </button>
                        )}
                        <button onClick={onClose} aria-label="Close"
                            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {error && (
                        <div className="m-5 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}
                        </div>
                    )}
                    {!result && !error && (
                        <div className="flex items-center justify-center gap-2 py-20 text-slate-400 text-sm">
                            <Loader2 size={18} className="animate-spin" /> Fitting failure behaviour per asset…
                        </div>
                    )}
                    {result && result.verdicts.length === 0 && (
                        <p className="text-center text-sm text-slate-400 py-16">
                            Nothing defensible to change — every active programme is consistent with its asset's failure history.
                        </p>
                    )}
                    {result && result.verdicts.length > 0 && (
                        <ul className="divide-y divide-slate-100">
                            {result.verdicts.map((v) => {
                                const meta = VERDICT_META[v.verdict];
                                const isDrafted = drafted.has(v.pmId);
                                return (
                                    <li key={v.pmId} className="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors">
                                        <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${meta.cls}`}>{meta.label}</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] text-slate-800">
                                                <span className="font-semibold">{v.code}</span>
                                                <span className="text-slate-400"> · {v.title}</span>
                                                <span className="ml-2 font-mono text-[11.5px] font-semibold text-primary-700">{v.tag}</span>
                                                {v.criticality && <span className="ml-1 text-[10px] font-bold text-slate-400">crit {v.criticality}</span>}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
                                                {v.currentIntervalDays != null && (
                                                    <span>{v.currentIntervalDays}d{v.recommendedIntervalDays != null && <> → <strong className="text-slate-700">{v.recommendedIntervalDays}d</strong></>}</span>
                                                )}
                                                {v.weibull && <span className="inline-flex items-center gap-1"><Activity size={11} /> β {v.weibull.beta} · B10 {v.weibull.b10Days}d · R² {v.weibull.r2}</span>}
                                                <span>{v.failures12mo} failure{v.failures12mo === 1 ? '' : 's'}/12mo</span>
                                                {v.eventsSavedPerYear > 0 && <span className="text-emerald-700 font-semibold">−{v.eventsSavedPerYear} PM events/yr</span>}
                                            </div>
                                            <p className="mt-1 text-[11.5px] text-slate-500 leading-relaxed">{v.reason}</p>
                                        </div>
                                        <div className="shrink-0">
                                            {isDrafted ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Check size={12} /> Queued</span>
                                            ) : (
                                                <button onClick={() => void draft(v)} disabled={drafting !== null}
                                                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:border-primary-300 hover:text-primary-700 text-slate-600 text-[11px] font-semibold px-2 h-7 disabled:opacity-45 transition-colors">
                                                    {drafting === v.pmId ? <Loader2 size={12} className="animate-spin" /> : <SendHorizonal size={12} />} Draft
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-slate-100 text-[10.5px] text-slate-400 shrink-0">
                    Verdicts are deterministic: censored Weibull per asset (≥3 corrective events), redundancy and effectiveness rules elsewhere.
                    Drafts land in the proposals queue — nothing changes a PM until a human approves and delivers it.
                </div>
            </div>
        </div>
    );
};

export default PmOptimizationModal;
