/**
 * ShiftHandoverModal — the 6am ritual, structured (RF-01 item 4).
 *
 * Outgoing writes in sixty seconds: pick the shift, say what matters; the
 * system freezes an activity snapshot (completions, new breakdowns, open
 * criticals since the last handover) alongside the words. Incoming reads and
 * acknowledges. Calm-screens pattern: the whole process lives in this popup.
 *
 * The snapshot is DELIBERATELY frozen at write time — a handover records what
 * was said and known then, not a live query that rewrites history.
 */
import React, { useEffect, useState } from 'react';
import {
    X, Loader2, ArrowRightLeft, CheckCircle2, Moon, Sun, AlertTriangle, Send,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface HandoverRow {
    id: string;
    shift_date: string;
    shift_label: string;
    author_name: string;
    notes: string | null;
    snapshot: Record<string, unknown>;
    ack_by: string | null;
    ack_at: string | null;
    created_at: string;
}

interface Props { open: boolean; onClose: () => void; currentUser: string; }

const OPEN_EXCLUDED = '("TECO","CLOSED","CANC","CANCELLED")';

async function buildSnapshot(sinceIso: string): Promise<Record<string, unknown>> {
    const [completedQ, breakdownsQ, criticalsQ] = await Promise.all([
        supabase.from('work_orders')
            .select('wo_number, title', { count: 'exact' })
            .gte('closed_at', sinceIso).limit(5),
        supabase.from('work_orders')
            .select('wo_number, title, breakdown, type', { count: 'exact' })
            .gte('created_at', sinceIso)
            .or('breakdown.eq.true,type.in.(CM,EM,BREAKDOWN,CORRECTIVE)')
            .limit(5),
        supabase.from('work_orders')
            .select('wo_number, title, priority_code', { count: 'exact' })
            .not('status', 'in', OPEN_EXCLUDED)
            .in('priority_code', ['P1', 'P2', 'HIGH', 'EMERGENCY'])
            .limit(5),
    ]);
    return {
        since: sinceIso,
        completed_count: completedQ.count ?? 0,
        completed_sample: (completedQ.data ?? []).map(w => `${w.wo_number} ${w.title}`.slice(0, 80)),
        new_breakdowns_count: breakdownsQ.count ?? 0,
        new_breakdowns_sample: (breakdownsQ.data ?? []).map(w => `${w.wo_number} ${w.title}`.slice(0, 80)),
        open_critical_count: criticalsQ.count ?? 0,
        open_critical_sample: (criticalsQ.data ?? []).map(w => `${w.wo_number} ${w.title}`.slice(0, 80)),
    };
}

const SnapshotLine: React.FC<{ snap: Record<string, unknown> }> = ({ snap }) => (
    <p className="text-[11px] text-slate-500 m-0">
        Since {snap.since ? new Date(String(snap.since)).toLocaleString() : '—'}:{' '}
        <b>{Number(snap.completed_count ?? 0)}</b> completed ·{' '}
        <b>{Number(snap.new_breakdowns_count ?? 0)}</b> new breakdown(s) ·{' '}
        <b>{Number(snap.open_critical_count ?? 0)}</b> open critical(s)
    </p>
);

export const ShiftHandoverModal: React.FC<Props> = ({ open, onClose, currentUser }) => {
    const [history, setHistory] = useState<HandoverRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [notes, setNotes] = useState('');
    const [shiftLabel, setShiftLabel] = useState<'DAY' | 'NIGHT'>(new Date().getHours() < 14 ? 'NIGHT' : 'DAY');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        const { data, error: err } = await supabase
            .from('shift_handovers')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);
        if (err) setError(`Could not load handovers: ${err.message} (migration 0300 applied?)`);
        setHistory((data ?? []) as HandoverRow[]);
        setLoading(false);
    };
    useEffect(() => { if (open) { setError(null); setNotes(''); void load(); } }, [open]);

    const latest = history[0] ?? null;
    const latestUnacked = latest && !latest.ack_at ? latest : null;

    const submit = async () => {
        if (!notes.trim()) return;
        setBusy(true); setError(null);
        try {
            const since = latest?.created_at ?? new Date(Date.now() - 12 * 3600000).toISOString();
            const snapshot = await buildSnapshot(since);
            const { error: err } = await supabase.from('shift_handovers').insert({
                shift_label: shiftLabel,
                author_name: currentUser,
                notes: notes.trim(),
                snapshot,
            });
            if (err) throw new Error(err.message);
            setNotes('');
            await load();
        } catch (e) {
            setError(`Could not save the handover: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    const acknowledge = async (row: HandoverRow) => {
        setBusy(true); setError(null);
        const { error: err } = await supabase.from('shift_handovers')
            .update({ ack_by: currentUser, ack_at: new Date().toISOString() })
            .eq('id', row.id)
            .is('ack_at', null);
        if (err) setError(`Could not acknowledge: ${err.message}`);
        await load();
        setBusy(false);
    };

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-2xl max-h-[88vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 border border-primary-100 flex items-center justify-center"><ArrowRightLeft size={16} /></span>
                        <div>
                            <h2 className="text-[15px] font-semibold text-slate-900 m-0">Shift handover</h2>
                            <p className="text-[11.5px] text-slate-400 m-0">What the next shift needs to know — with the activity record frozen alongside it</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} className="text-slate-400" /></button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                        </div>
                    )}

                    {/* Incoming: acknowledge the outstanding handover */}
                    {latestUnacked && (
                        <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-bold text-primary-800 m-0 flex items-center gap-1.5">
                                    {latestUnacked.shift_label === 'NIGHT' ? <Moon size={13} /> : <Sun size={13} />}
                                    {latestUnacked.shift_label} shift · {latestUnacked.author_name} · {new Date(latestUnacked.created_at).toLocaleString()}
                                </p>
                                <button onClick={() => void acknowledge(latestUnacked)} disabled={busy}
                                    className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[11px] font-semibold px-3 py-1.5 disabled:opacity-40">
                                    <CheckCircle2 size={12} /> Acknowledge
                                </button>
                            </div>
                            {latestUnacked.notes && <p className="text-sm text-slate-700 whitespace-pre-wrap m-0">{latestUnacked.notes}</p>}
                            <SnapshotLine snap={latestUnacked.snapshot ?? {}} />
                        </div>
                    )}

                    {/* Outgoing: write the handover */}
                    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-700">Hand over the</span>
                            {(['DAY', 'NIGHT'] as const).map(s => (
                                <button key={s} onClick={() => setShiftLabel(s)}
                                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold border transition-colors ${shiftLabel === s ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                    {s === 'NIGHT' ? <Moon size={11} /> : <Sun size={11} />} {s.toLowerCase()} shift
                                </button>
                            ))}
                        </div>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                            placeholder="What does the next shift need to know? Carry-overs, watch items, promises made…"
                            className="w-full h-24 rounded-lg border border-slate-200 p-3 text-sm resize-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-slate-400 m-0">
                                Completions, new breakdowns and open criticals since the last handover are attached automatically.
                            </p>
                            <button onClick={() => void submit()} disabled={busy || !notes.trim()}
                                className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2 disabled:opacity-40 shrink-0">
                                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Hand over
                            </button>
                        </div>
                    </div>

                    {/* History */}
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
                    ) : history.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 m-0">Recent handovers</p>
                            {history.map(h => (
                                <div key={h.id} className="rounded-lg border border-slate-100 px-3.5 py-2.5">
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                        <span className="font-semibold">{h.shift_label} · {h.author_name} · {new Date(h.created_at).toLocaleString()}</span>
                                        {h.ack_at
                                            ? <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} /> ack {h.ack_by}</span>
                                            : <span className="text-amber-600">unacknowledged</span>}
                                    </div>
                                    {h.notes && <p className="text-[12.5px] text-slate-600 mt-1 mb-0 whitespace-pre-wrap line-clamp-3">{h.notes}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ShiftHandoverModal;
