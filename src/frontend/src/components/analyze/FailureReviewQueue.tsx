/**
 * FailureReviewQueue — the FRACAS ritual as a queue that empties (RF-01 item 6).
 *
 * Every failure event (canonical isFailure) whose coding no engineer has
 * confirmed, uncoded first. Inline ISO 14224 coding from the reference-code
 * catalog; "mark reviewed" stamps wo_failure_data.reviewed_by/at (0300);
 * repeat offenders get a one-click path into RCA. Coding data is born at WO
 * close-out — this queue is where an engineer CONFIRMS it, which is the
 * difference between coded data and trusted data.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ClipboardCheck, Loader2, CheckCircle2, AlertTriangle, Search, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { isFailure, eventDate } from '../../eam/services/reliabilityMetrics';

interface QueueRow {
    id: string;
    wo_number: string | null;
    title: string | null;
    asset_id: string | null;
    asset_tag: string;
    event_at: string | null;
    mode: string | null;
    cause: string | null;
    hasSidecar: boolean;
}

interface CatalogCode { code: string; description: string | null; }

export const FailureReviewQueue: React.FC<{ currentUser: string; onCountChange?: (n: number) => void }> = ({ currentUser, onCountChange }) => {
    const navigate = useNavigate();
    const [rows, setRows] = useState<QueueRow[]>([]);
    const [modes, setModes] = useState<CatalogCode[]>([]);
    const [causes, setCauses] = useState<CatalogCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    /** wo_id → draft coding edits before save */
    const [drafts, setDrafts] = useState<Record<string, { mode?: string; cause?: string }>>({});

    const load = async () => {
        setLoading(true); setError(null);
        try {
            const [woQ, assetQ, modeQ, causeQ] = await Promise.all([
                supabase.from('work_orders')
                    .select('id, wo_number, title, asset_id, type, status, created_at, closed_at, breakdown, malfunction_start, wo_failure_data!wo_id(failure_mode_code, failure_cause_code, secondary_failure, reviewed_at)')
                    .order('created_at', { ascending: false })
                    .limit(2000),
                supabase.from('assets').select('id, tag').limit(10000),
                supabase.from('reference_codes').select('code, description').eq('category', 'FAILURE_MODE').limit(500),
                supabase.from('reference_codes').select('code, description').eq('category', 'FAILURE_CAUSE').limit(500),
            ]);
            if (woQ.error) throw woQ.error;
            const tagById = new Map(((assetQ.data ?? []) as any[]).map(a => [a.id, a.tag]));
            const queue: QueueRow[] = ((woQ.data ?? []) as any[])
                .filter(w => isFailure(w))
                .map(w => {
                    const fd = Array.isArray(w.wo_failure_data) ? w.wo_failure_data[0] : w.wo_failure_data;
                    return { w, fd };
                })
                .filter(({ fd }) => !fd?.reviewed_at)
                .map(({ w, fd }) => ({
                    id: w.id,
                    wo_number: w.wo_number,
                    title: w.title,
                    asset_id: w.asset_id,
                    asset_tag: tagById.get(w.asset_id) ?? '—',
                    event_at: eventDate(w) ?? null,
                    mode: fd?.failure_mode_code ?? null,
                    cause: fd?.failure_cause_code ?? null,
                    hasSidecar: !!fd,
                }))
                // Uncoded events first — they are the data-quality debt.
                .sort((a, b) => (Number(!!a.mode) - Number(!!b.mode)) || String(b.event_at).localeCompare(String(a.event_at)));
            setRows(queue);
            onCountChange?.(queue.length);
            setModes((modeQ.data ?? []) as CatalogCode[]);
            setCauses((causeQ.data ?? []) as CatalogCode[]);
        } catch (e) {
            setError(`Could not load the review queue: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { void load(); }, []);

    const review = async (row: QueueRow) => {
        setBusy(row.id); setError(null);
        try {
            const d = drafts[row.id] ?? {};
            const { error: err } = await supabase.from('wo_failure_data').upsert({
                wo_id: row.id,
                failure_mode_code: d.mode ?? row.mode,
                failure_cause_code: d.cause ?? row.cause,
                reviewed_by: currentUser,
                reviewed_at: new Date().toISOString(),
            }, { onConflict: 'wo_id' });
            if (err) throw err;
            setRows(prev => { const next = prev.filter(r => r.id !== row.id); onCountChange?.(next.length); return next; });
        } catch (e) {
            setError(`Could not save the review: ${e instanceof Error ? e.message : String(e)} (migration 0300 applied?)`);
        } finally {
            setBusy(null);
        }
    };

    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r => `${r.wo_number} ${r.title} ${r.asset_tag}`.toLowerCase().includes(q));
    }, [rows, filter]);

    const uncoded = rows.filter(r => !r.mode).length;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
                <ClipboardCheck size={15} className="text-primary-600" />
                <h3 className="text-sm font-bold text-slate-800 m-0">Failure review</h3>
                <span className="text-[11px] text-slate-400">
                    {loading ? 'loading…' : `${rows.length} unreviewed failure event(s) · ${uncoded} uncoded`}
                </span>
                <div className="ml-auto relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
                        className="pl-6 pr-2 py-1 text-xs rounded-lg border border-slate-200 w-36" />
                </div>
            </div>

            {error && (
                <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> Building the queue…</div>
            ) : rows.length === 0 ? (
                <div className="py-12 text-center">
                    <CheckCircle2 size={26} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-700 m-0">Queue is empty</p>
                    <p className="text-xs text-slate-400 mt-1">Every failure event's coding has been confirmed. New failures land here as they close.</p>
                </div>
            ) : (
                <div className="divide-y divide-slate-50 max-h-[32rem] overflow-y-auto">
                    {shown.slice(0, 100).map(r => (
                        <div key={r.id} className="px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-2.5">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    {!r.mode && <span className="text-[9px] font-bold uppercase tracking-wide bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-1.5 py-0.5 shrink-0">uncoded</span>}
                                    <button onClick={() => navigate(`/work-orders/${r.id}`)}
                                        className="text-sm font-medium text-slate-800 hover:text-primary-700 truncate text-left">
                                        {r.wo_number} · {r.title}
                                    </button>
                                </div>
                                <div className="text-[11px] text-slate-400">
                                    {r.asset_tag} · {r.event_at ? new Date(r.event_at).toLocaleDateString() : '—'}
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <select value={drafts[r.id]?.mode ?? r.mode ?? ''}
                                    onChange={e => setDrafts(p => ({ ...p, [r.id]: { ...p[r.id], mode: e.target.value || undefined } }))}
                                    className="text-[11px] rounded-lg border border-slate-200 px-1.5 py-1.5 bg-white max-w-[9.5rem]">
                                    <option value="">mode…</option>
                                    {modes.map(m => <option key={m.code} value={m.code}>{m.code} {m.description?.slice(0, 24) ?? ''}</option>)}
                                </select>
                                <select value={drafts[r.id]?.cause ?? r.cause ?? ''}
                                    onChange={e => setDrafts(p => ({ ...p, [r.id]: { ...p[r.id], cause: e.target.value || undefined } }))}
                                    className="text-[11px] rounded-lg border border-slate-200 px-1.5 py-1.5 bg-white max-w-[9.5rem]">
                                    <option value="">cause…</option>
                                    {causes.map(c => <option key={c.code} value={c.code}>{c.code} {c.description?.slice(0, 24) ?? ''}</option>)}
                                </select>
                                <button onClick={() => void review(r)} disabled={busy !== null}
                                    title="Confirm this event's coding and clear it from the queue"
                                    className="flex items-center gap-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[11px] font-semibold px-2.5 py-1.5 disabled:opacity-40">
                                    {busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Reviewed
                                </button>
                                {r.asset_id && (
                                    <button onClick={() => navigate(`/analyze?asset=${encodeURIComponent(r.asset_id!)}&tab=rca&from=failure-review`)}
                                        title="Open a root-cause investigation for this asset"
                                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-medium px-2 py-1.5">
                                        RCA <ExternalLink size={10} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {shown.length > 100 && (
                        <p className="px-4 py-2 text-[11px] text-slate-400 m-0">Showing 100 of {shown.length} — review from the top; the queue refills as you clear it.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default FailureReviewQueue;
