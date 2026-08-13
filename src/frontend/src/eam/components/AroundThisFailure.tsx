/**
 * AroundThisFailure — the systems-thinking panel (Phase 1 of
 * docs/Systems-Thinking-Failure-Analysis-Plan.md).
 *
 * Two things, in plain language:
 *   1. "What else happened around this time?" — failure events plant-wide
 *      within ±24h of this WO's failure event time (malfunction_start when
 *      recorded, else the report time), sorted by proximity.
 *   2. "Was this caused by another failure?" — the one question that records
 *      the ISO 14224 primary/secondary distinction. Linking a cause marks
 *      this record as collateral (kept out of the victim asset's MTBF, always
 *      shown separately) and journals BOTH work orders.
 *
 * The system proposes; the person confirms. No cause is ever auto-linked.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, ArrowRight, CheckCircle, Zap, Undo2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DatabaseService } from '../services/DatabaseService';
import { isFailure } from '../services/reliabilityMetrics';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { WorkOrder } from '../types';

const WINDOW_HOURS = 24;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CandidateWo {
    id: string;
    wo_number?: string;
    title?: string;
    type?: string;
    status?: string;
    asset_id?: string;
    assetTag?: string;
    assetName?: string;
    eventAt: number;   // ms
    gapMs: number;     // candidate − this event (negative = before)
}

const eventTimeOf = (r: any): number | null => {
    const d = r.malfunction_start || r.closed_at || r.created_at;
    const t = d ? new Date(d).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
};

const formatGap = (gapMs: number): string => {
    const abs = Math.abs(gapMs);
    const dir = gapMs < 0 ? 'before' : 'after';
    if (abs < 90 * 60000) return `${Math.max(1, Math.round(abs / 60000))} min ${dir}`;
    return `${(abs / 3600000).toFixed(1)}h ${dir}`;
};

export const AroundThisFailure: React.FC<{
    job: WorkOrder;
    onUpdate: (u: Partial<WorkOrder>) => void;
    /** true = parent supplies the card + heading (compact strip); render content only */
    embedded?: boolean;
}> = ({ job, onUpdate, embedded = false }) => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { profile } = useAuth();
    const [candidates, setCandidates] = useState<CandidateWo[]>([]);
    const [victims, setVictims] = useState<{ id: string; wo_number?: string; title?: string; assetTag?: string }[]>([]);
    const [causeWo, setCauseWo] = useState<{ id: string; wo_number?: string; title?: string; assetTag?: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [linking, setLinking] = useState(false);

    // This WO's failure event time: real malfunction start when recorded,
    // else the report time (creation) as the honest proxy.
    const myEventMs = useMemo(() => {
        const d = job.malfunctionStart || job.dateCreated;
        const t = d ? new Date(d).getTime() : NaN;
        return Number.isFinite(t) ? t : null;
    }, [job.malfunctionStart, job.dateCreated]);

    // Demo/mock records have non-uuid ids — every query and write would fail.
    const isDemoRecord = !UUID_RE.test(job.id || '');

    useEffect(() => {
        let active = true;
        if (isDemoRecord) { setLoading(false); return; }
        (async () => {
            setLoading(true);
            try {
                const assets = await DatabaseService.getInstance().getAssets().catch(() => [] as any[]);
                const assetById = new Map<string, any>((assets || []).map((a: any) => [a.id, a]));
                const decorate = (w: any) => ({
                    id: w.id,
                    wo_number: w.wo_number,
                    title: w.title,
                    type: w.type,
                    status: w.status,
                    asset_id: w.asset_id,
                    assetTag: assetById.get(w.asset_id)?.tag,
                    assetName: assetById.get(w.asset_id)?.name,
                });

                // 1. Temporal neighbours: fetch a generous created_at window, then
                //    filter to canonical failures within ±24h of the event time
                //    client-side (the event basis is COALESCE'd across columns,
                //    which PostgREST can't window on directly).
                if (myEventMs != null) {
                    const from = new Date(myEventMs - 14 * 86400000).toISOString();
                    const to = new Date(myEventMs + 2 * 86400000).toISOString();
                    const { data: wos } = await supabase
                        .from('work_orders')
                        .select('id, wo_number, title, type, status, asset_id, malfunction_start, closed_at, created_at, wo_failure_data(failure_mode_code, secondary_failure)')
                        .neq('id', job.id)
                        .gte('created_at', from)
                        .lte('created_at', to)
                        .limit(500);
                    const windowMs = WINDOW_HOURS * 3600000;
                    const cands: CandidateWo[] = [];
                    for (const w of (wos || []) as any[]) {
                        if (!isFailure(w)) continue;
                        const t = eventTimeOf(w);
                        if (t == null) continue;
                        const gapMs = t - myEventMs;
                        if (Math.abs(gapMs) > windowMs) continue;
                        cands.push({ ...decorate(w), eventAt: t, gapMs });
                    }
                    cands.sort((a, b) => Math.abs(a.gapMs) - Math.abs(b.gapMs));
                    if (active) setCandidates(cands.slice(0, 12));
                }

                // 2. Collateral recorded FROM this failure (the initiator's view).
                const { data: victimRows } = await supabase
                    .from('wo_failure_data')
                    .select('wo_id')
                    .eq('caused_by_wo_id', job.id);
                const victimIds = (victimRows || []).map((r: any) => r.wo_id).filter(Boolean);
                if (victimIds.length > 0) {
                    const { data: victimWos } = await supabase
                        .from('work_orders')
                        .select('id, wo_number, title, asset_id')
                        .in('id', victimIds);
                    if (active) setVictims((victimWos || []).map(decorate));
                } else if (active) {
                    setVictims([]);
                }

                // 3. The cause WO's label, when this record is already collateral.
                if (job.failureData?.causedByWoId) {
                    const { data: cw } = await supabase
                        .from('work_orders')
                        .select('id, wo_number, title, asset_id')
                        .eq('id', job.failureData.causedByWoId)
                        .maybeSingle();
                    if (active) setCauseWo(cw ? decorate(cw) : null);
                } else if (active) {
                    setCauseWo(null);
                }
            } catch (e) {
                console.warn('[AroundThisFailure] load failed:', e);
            }
            if (active) setLoading(false);
        })();
        return () => { active = false; };
    }, [job.id, myEventMs, job.failureData?.causedByWoId]);

    const sysJournal = (entry: string) => ({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sys-${Date.now()}`,
        type: 'SYSTEM',
        entry,
        createdBy: profile?.username || 'system',
        createdAt: new Date().toISOString(),
        isSystem: true,
    });

    const linkCause = async (cand: CandidateWo) => {
        setLinking(true);
        // This WO: mark collateral + journal, through the normal save path.
        onUpdate({
            failureData: { ...job.failureData, secondaryFailure: true, causedByWoId: cand.id },
            journals: [
                sysJournal(`Marked as collateral damage caused by ${cand.wo_number || cand.id} (${cand.assetTag || 'asset'} — ${cand.title || ''})`),
                ...(job.journals || []),
            ],
        } as any);
        // The INITIATOR's record gets the mirror entry directly (append-only table).
        try {
            await supabase.from('journal_entries').insert({
                entity_id: cand.id,
                entity_type: 'WORK_ORDER',
                entry_type: 'SYSTEM',
                entry: `Collateral damage recorded: this failure caused ${job.woNumber || job.id} on ${job.assetCode || job.assetName || 'another asset'}.`,
                is_system: true,
                client_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sys-${Date.now()}`,
                author_name: profile?.username || 'system',
            });
        } catch (e) {
            console.warn('[AroundThisFailure] initiator journal failed (non-blocking):', e);
        }
        showToast(`Linked: this failure was caused by ${cand.wo_number || 'the selected WO'}. It won't count against ${job.assetCode || 'this asset'}'s reliability.`, 'success');
        setLinking(false);
    };

    const markPrimary = () => {
        onUpdate({ failureData: { ...job.failureData, secondaryFailure: false, causedByWoId: undefined } });
        showToast('Recorded as a primary failure (the asset’s own).', 'success');
    };

    const resetAnswer = () => {
        onUpdate({ failureData: { ...job.failureData, secondaryFailure: undefined, causedByWoId: undefined } });
    };

    const answered = job.failureData?.secondaryFailure !== undefined;
    const isCollateral = job.failureData?.secondaryFailure === true;

    if (isDemoRecord) {
        return (
            <div className={embedded ? '' : 'bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm'}>
                {!embedded && (
                    <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
                        <Network className="text-blue-600" size={14} /> Around This Failure
                    </h3>
                )}
                <p className="text-xs text-slate-400">
                    This is a demo record (live data was unavailable when the list loaded) — systems analysis needs a saved
                    work order. Reload the page to get live data.
                </p>
            </div>
        );
    }

    return (
        <div className={embedded ? '' : 'bg-white p-3 md:p-4 rounded-lg border border-slate-200 shadow-sm'}>
            {!embedded && (
                <h3 className="font-bold text-xs md:text-sm text-slate-800 border-b border-slate-100 pb-2 mb-3 flex items-center gap-1.5">
                    <Network className="text-blue-600" size={14} /> Around This Failure
                    <span className="text-[10px] font-normal text-slate-400 ml-auto">±{WINDOW_HOURS}h plant-wide</span>
                </h3>
            )}

            {/* ── The question / the answer ── */}
            {!answered ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-xs font-bold text-blue-800">Was this failure caused by another failure?</p>
                    <p className="text-[11px] text-blue-700 mt-0.5 mb-2">
                        If another equipment failure damaged this asset (collateral damage), link it — the failure is charged
                        to the cause, and this asset's reliability record stays honest.
                    </p>
                    <button
                        onClick={markPrimary}
                        className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100"
                    >
                        No — this is the asset's own failure
                    </button>
                    <span className="text-[11px] text-blue-600 ml-2">or pick the cause from the events below.</span>
                </div>
            ) : isCollateral ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
                    <Zap size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 text-xs text-amber-800">
                        <span className="font-bold">Collateral damage</span> — caused by{' '}
                        {causeWo ? (
                            <button onClick={() => navigate(`/work-orders/${causeWo.id}`)} className="font-mono font-bold underline hover:text-amber-900">
                                {causeWo.wo_number || causeWo.id}
                            </button>
                        ) : 'another failure'}
                        {causeWo?.assetTag ? ` (${causeWo.assetTag})` : ''}. Excluded from this asset's MTBF; shown as collateral.
                    </div>
                    <button onClick={resetAnswer} title="Change answer" className="p-1 text-amber-500 hover:text-amber-700 flex-shrink-0"><Undo2 size={13} /></button>
                </div>
            ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2 text-xs text-emerald-800">
                    <CheckCircle size={13} className="text-emerald-600 flex-shrink-0" />
                    <span className="flex-1">Recorded as a <span className="font-bold">primary failure</span> — the asset's own.</span>
                    <button onClick={resetAnswer} title="Change answer" className="p-1 text-emerald-500 hover:text-emerald-700"><Undo2 size={13} /></button>
                </div>
            )}

            {/* ── Temporal neighbours ── */}
            {loading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-3"><Loader2 size={13} className="animate-spin" /> Scanning plant events…</div>
            ) : candidates.length === 0 ? (
                <p className="text-xs text-slate-400 py-1">No other failures recorded within {WINDOW_HOURS}h of this event.</p>
            ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                    {candidates.map(c => (
                        <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50">
                            <span className={`font-bold flex-shrink-0 w-20 ${c.gapMs < 0 ? 'text-red-600' : 'text-slate-400'}`}>{formatGap(c.gapMs)}</span>
                            <button
                                onClick={() => navigate(`/work-orders/${c.id}`)}
                                className="font-mono font-bold text-blue-600 hover:underline flex-shrink-0"
                            >
                                {c.wo_number || c.id.slice(0, 8)}
                            </button>
                            <span className="text-slate-500 flex-shrink-0">{c.assetTag || '—'}</span>
                            <span className="text-slate-600 truncate flex-1">{c.title}</span>
                            {!isCollateral && (
                                <button
                                    onClick={() => linkCause(c)}
                                    disabled={linking}
                                    title="This failure caused my failure (collateral damage)"
                                    className="px-2 py-1 text-[10px] font-bold rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 flex-shrink-0"
                                >
                                    This caused it
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Collateral this failure caused (initiator's view) ── */}
            {victims.length > 0 && (
                <div className="mt-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1">
                        <Zap size={11} className="text-orange-500" /> This failure caused collateral damage
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {victims.map(v => (
                            <button
                                key={v.id}
                                onClick={() => navigate(`/work-orders/${v.id}`)}
                                className="px-2 py-1 text-[11px] rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold hover:bg-orange-100 flex items-center gap-1"
                            >
                                {v.wo_number || v.id.slice(0, 8)} · {v.assetTag || v.title}
                                <ArrowRight size={10} />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
