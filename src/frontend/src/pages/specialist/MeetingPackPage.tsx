/**
 * MeetingPackPage — the weekly reliability meeting, auto-drafted (Phase F3,
 * docs/Specialist-150k-Replacement-Plan.md).
 *
 * Tools don't move plants; operating rhythms do. The Specialist writes the
 * pack, the leader runs the room: wins to recognise, decisions stuck in the
 * queue (decision latency IS the culture KPI), the night watchdog's signals,
 * and the numbers that moved. Every figure deterministic; printable like the
 * assessment and the ROI statement.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Printer, Loader2, Trophy, Hourglass, Radar, Gauge as GaugeIcon,
    ClipboardList, CalendarCheck, ShieldCheck,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useSettings } from '../../contexts/SettingsContext';
import { predictionService, type AgentAction } from '../../eam/services/PredictionService';
import type { AssessmentSnapshot } from '../../eam/services/assessmentSnapshotService';

const DAY_MS = 86_400_000;

interface PackData {
    pending: (AgentAction & { ageDays: number })[];
    approvedThisWeek: AgentAction[];
    watchdogRuns: { created_at: string; response_text: string; context_summary: string }[];
    newRcaDrafts: { id: string; title: string; created_at: string }[];
    latest: AssessmentSnapshot | null;
    weekAgo: AssessmentSnapshot | null;
    monthSpend: { label: string; cost: number }[]; // last 2 fixed months
    plantOee: { oee_pct?: number | null; availability_pct?: number | null } | null;
    /** F2 — loss decomposition from production events (30 days), defensive shape. */
    losses: Record<string, unknown>[];
}

async function loadPack(): Promise<PackData> {
    const now = Date.now();
    const weekAgoIso = new Date(now - 7 * DAY_MS).toISOString();
    const [actions, logQ, rcaQ, snapQ, woQ, oeeQ, lossQ] = await Promise.all([
        predictionService.getAgentActions(),
        supabase.from('ers_ai_audit_log')
            .select('created_at, response_text, context_summary')
            .eq('context_type', 'watchdog_run')
            .gte('created_at', weekAgoIso)
            .order('created_at', { ascending: false }).limit(10),
        supabase.from('ers_rca_investigations')
            .select('id, title, created_at')
            .eq('status', 'draft')
            .gte('created_at', weekAgoIso)
            .order('created_at', { ascending: false }).limit(10),
        supabase.from('ers_assessment_snapshots')
            .select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('work_orders')
            .select('created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost')
            .gte('created_at', new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1).toISOString())
            .limit(20000),
        supabase.rpc('get_plant_oee', {
            p_from: new Date(now - 30 * DAY_MS).toISOString().slice(0, 10),
            p_to: new Date(now).toISOString().slice(0, 10),
        }),
        supabase.rpc('get_oee_losses', {
            p_asset_id: null,
            p_from: new Date(now - 30 * DAY_MS).toISOString().slice(0, 10),
            p_to: new Date(now).toISOString().slice(0, 10),
        }),
    ]);

    const pending = actions
        .filter((a) => a.status === 'pending_review')
        .map((a) => ({ ...a, ageDays: Math.floor((now - new Date(a.created_at).getTime()) / DAY_MS) }))
        .sort((a, b) => b.ageDays - a.ageDays);
    const approvedThisWeek = actions.filter((a) =>
        a.status === 'approved' && a.reviewed_at && new Date(a.reviewed_at).getTime() >= now - 7 * DAY_MS);

    const snaps = (snapQ.data ?? []) as AssessmentSnapshot[];
    const latest = snaps[0] ?? null;
    const weekAgo = snaps.find((s) => new Date(s.created_at).getTime() <= now - 6 * DAY_MS) ?? snaps[snaps.length - 1] ?? null;

    // Fixed calendar months: previous full month vs current month-to-date.
    const months = new Map<string, number>();
    for (const w of (woQ.data ?? []) as Record<string, unknown>[]) {
        const key = String(w.created_at).slice(0, 7);
        const c = ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0;
        months.set(key, (months.get(key) ?? 0) + c);
    }
    const monthSpend = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-2)
        .map(([label, cost]) => ({ label, cost: Math.round(cost) }));

    const oeeRow = Array.isArray(oeeQ.data) ? oeeQ.data[0] : oeeQ.data;

    return {
        pending,
        approvedThisWeek,
        watchdogRuns: (logQ.data ?? []) as PackData['watchdogRuns'],
        newRcaDrafts: (rcaQ.data ?? []) as PackData['newRcaDrafts'],
        latest, weekAgo, monthSpend,
        plantOee: (oeeRow ?? null) as PackData['plantOee'],
        losses: Array.isArray(lossQ.data) ? (lossQ.data as Record<string, unknown>[]).slice(0, 5) : [],
    };
}

const draftTitle = (a: AgentAction): string => {
    const p = (a.draft_payload ?? {}) as Record<string, unknown>;
    return String(p.title ?? p.recommendation_type ?? a.action_type ?? 'Proposal');
};

export const MeetingPackPage: React.FC = () => {
    const navigate = useNavigate();
    const { formatCurrency } = useSettings();
    const [data, setData] = useState<PackData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadPack().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, []);

    if (error) return <div className="max-w-xl mx-auto mt-20 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-800 text-sm">{error}</div>;
    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <Loader2 size={28} className="animate-spin text-primary-600" />
                <p className="text-sm">Drafting this week's meeting pack…</p>
            </div>
        );
    }

    const meanLatency = data.pending.length
        ? Math.round((data.pending.reduce((s, p) => s + p.ageDays, 0) / data.pending.length) * 10) / 10
        : 0;
    const stuck = data.pending.filter((p) => p.ageDays > 7);
    const delta = (cur?: number | null, prev?: number | null) =>
        cur == null || prev == null ? null : Math.round((Number(cur) - Number(prev)) * 10) / 10;

    const Section: React.FC<{ n: number; icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ n, icon, title, children }) => (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:p-0 print:mb-6 break-inside-avoid">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center">{n}</span>
                {icon}{title}
            </h2>
            {children}
        </section>
    );

    return (
        <>
            <style>{`
                @media print {
                    body { background: #fff !important; }
                    .no-print { display: none !important; }
                    aside, nav, header.app-header { display: none !important; }
                }
            `}</style>

            <div className="no-print flex items-center justify-between mb-5">
                <button onClick={() => navigate('/specialist')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
                    <ArrowLeft size={15} /> Specialist workspace
                </button>
                <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2">
                    <Printer size={13} /> Print / PDF
                </button>
            </div>

            <div className="ers-page-form space-y-5 pb-24">
                {/* Cover */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden print:rounded-none print:border-0">
                    <div className="h-1 bg-violet-600 print:hidden" />
                    <div className="p-6 sm:p-8">
                        <p className="text-violet-700 text-[11px] font-bold uppercase tracking-[0.12em]">Weekly reliability meeting</p>
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight mt-1.5">
                            The Specialist wrote the pack — you run the room
                        </h1>
                        <p className="text-[13px] text-slate-500 mt-2">Week of {new Date().toISOString().slice(0, 10)} · every figure computed from your records.</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-6 bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                            {[
                                {
                                    label: 'Decision latency', value: data.pending.length ? `${meanLatency}d` : '—',
                                    sub: 'mean age of pending proposals — the culture KPI',
                                },
                                { label: 'Stuck > 7 days', value: String(stuck.length), sub: 'proposals waiting on a decision' },
                                { label: 'Wins this week', value: String(data.approvedThisWeek.length), sub: 'proposals a human approved' },
                                { label: 'Watchdog nights', value: String(data.watchdogRuns.length), sub: 'automated sweeps in the last 7 days' },
                            ].map((s) => (
                                <div key={s.label} className="bg-white p-3.5">
                                    <div className="text-lg md:text-2xl font-semibold text-slate-900 tabular-nums tracking-tight">{s.value}</div>
                                    <div className="text-[10.5px] text-slate-400 mt-1 leading-tight">{s.label}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{s.sub}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 1 — wins */}
                <Section n={1} icon={<Trophy size={15} className="text-emerald-600" />} title="Wins to recognise">
                    {data.approvedThisWeek.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No proposals were approved this week — if the queue below has items, that is the meeting's first agenda point.</p>
                    ) : (
                        <ul className="space-y-2">
                            {data.approvedThisWeek.map((a) => (
                                <li key={a.id} className="flex items-start gap-2 text-sm text-slate-700">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    <span><strong>{draftTitle(a)}</strong> — approved by {a.reviewed_by ?? 'a reviewer'} · name the people who did the underlying work.</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                {/* 2 — decisions */}
                <Section n={2} icon={<Hourglass size={15} className="text-amber-500" />} title="Decisions this room owes">
                    {data.pending.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">The proposals queue is clear — nothing is waiting on leadership.</p>
                    ) : (
                        <>
                            <ul className="space-y-2 mb-3">
                                {data.pending.slice(0, 8).map((p) => (
                                    <li key={p.id} className="flex items-start gap-2 text-sm text-slate-700">
                                        <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${p.ageDays > 7 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{p.ageDays}d</span>
                                        <span>{draftTitle(p)} <span className="text-slate-400 text-xs">({String(p.agent_type).replaceAll('_', ' ')})</span></span>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-xs text-slate-500">
                                Every day a proposal waits is a day its value doesn't start — and the measurement clock starts at approval.
                                Decide in the room: approve, reject, or name the blocker.
                            </p>
                        </>
                    )}
                </Section>

                {/* 3 — signals */}
                <Section n={3} icon={<Radar size={15} className="text-sky-600" />} title="What the night shift found">
                    {data.watchdogRuns.length === 0 && data.newRcaDrafts.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No watchdog runs recorded this week.</p>
                    ) : (
                        <div className="space-y-2 text-sm text-slate-700">
                            {data.watchdogRuns.slice(0, 3).map((r, i) => (
                                <p key={i} className="text-[13px]"><span className="text-slate-400 text-xs tabular-nums">{String(r.created_at).slice(0, 10)}</span> · {r.response_text.split('\n')[0]}</p>
                            ))}
                            {data.newRcaDrafts.map((r) => (
                                <p key={r.id} className="text-[13px]">
                                    <span className="rounded bg-rose-50 text-rose-600 text-[10px] font-bold px-1.5 py-0.5 mr-1.5">RCA DRAFT</span>
                                    {r.title} — assign an owner in this meeting.
                                </p>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 4 — numbers */}
                <Section n={4} icon={<GaugeIcon size={15} className="text-indigo-500" />} title="The numbers that moved">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            {
                                label: 'Spend (fixed months)',
                                value: data.monthSpend.length === 2
                                    ? `${formatCurrency(data.monthSpend[1].cost)}`
                                    : '—',
                                sub: data.monthSpend.length === 2
                                    ? `${data.monthSpend[1].label} to date · ${data.monthSpend[0].label}: ${formatCurrency(data.monthSpend[0].cost)}`
                                    : 'needs two months of history',
                            },
                            {
                                label: 'Register health',
                                value: data.latest?.register_health_pct != null ? `${data.latest.register_health_pct}%` : '—',
                                sub: (() => { const d = delta(data.latest?.register_health_pct, data.weekAgo?.register_health_pct); return d == null || d === 0 ? 'vs last week: unchanged' : `vs last week: ${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pts`; })(),
                            },
                            {
                                label: 'Strategy coverage',
                                value: data.latest?.strategy_coverage_pct != null ? `${data.latest.strategy_coverage_pct}%` : '—',
                                sub: 'A/B assets with a deliberate regime · world-class ≥95%',
                            },
                            {
                                label: 'OEE / Success Rate',
                                value: data.plantOee?.oee_pct != null ? `${Math.round(Number(data.plantOee.oee_pct))}%` : '—',
                                sub: data.latest?.success_rate_pct != null
                                    ? `plant OEE 30d · PSC SR ${Math.round(Number(data.latest.success_rate_pct))}% (target ≥90)`
                                    : 'plant OEE 30d · SR unlocks with banded points',
                            },
                        ].map((c) => (
                            <div key={c.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                                <div className="text-xl font-bold text-slate-800 tabular-nums">{c.value}</div>
                                <div className="text-[11px] text-slate-500 mt-0.5">{c.label}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{c.sub}</div>
                            </div>
                        ))}
                    </div>
                    {/* F2 — loss decomposition, tied back to the strategy that attacks it */}
                    {data.losses.length > 0 && (
                        <div className="mt-4">
                            <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">Top production losses (30 days)</div>
                            <ul className="space-y-1">
                                {data.losses.map((l, i) => {
                                    const label = String(l.loss_label ?? l.loss_category ?? 'loss');
                                    const hours = Number(l.total_hours ?? l.downtime_hours ?? l.hours ?? 0);
                                    const events = Number(l.event_count ?? l.events ?? 0);
                                    return (
                                        <li key={i} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                                            <span className="flex-1">{label}</span>
                                            <span className="font-mono tabular-nums text-slate-700">{hours ? `${Math.round(hours * 10) / 10}h` : ''}{events ? ` · ${events}×` : ''}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="text-[10.5px] text-slate-400 mt-1.5">
                                Availability losses trace to assets — the assessment's maintenance-strategy section names the regime that attacks each one.
                            </p>
                        </div>
                    )}
                    <p className="text-[10.5px] text-slate-400 mt-3">
                        Spend shown as fixed calendar months (never rolling-window deltas). Register health, strategy coverage and SR trend from the assessment snapshots.
                    </p>
                </Section>

                {/* 5 — standing agenda */}
                <Section n={5} icon={<ClipboardList size={15} className="text-slate-500" />} title="Standing agenda">
                    <ul className="space-y-1.5 text-sm text-slate-600">
                        <li className="flex gap-2"><CalendarCheck size={14} className="mt-0.5 text-slate-400 shrink-0" /> Review this week's briefing missions on the <button onClick={() => navigate('/specialist')} className="no-print text-primary-600 hover:underline font-medium">workspace</button><span className="hidden print:inline">workspace</span> — they self-verify from the records.</li>
                        <li className="flex gap-2"><CalendarCheck size={14} className="mt-0.5 text-slate-400 shrink-0" /> One strategy gap from the assessment's worst-first list: decide its regime in the room.</li>
                        <li className="flex gap-2"><CalendarCheck size={14} className="mt-0.5 text-slate-400 shrink-0" /> Data hygiene minute: are closures carrying failure codes, costs and downtime? Those three fields power everything above.</li>
                    </ul>
                </Section>

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <ShieldCheck size={11} /> IREAMS · Reliability Specialist by Relantern — weekly leadership pack, drafted {new Date().toISOString().slice(0, 10)}. Deterministic; nothing estimated by AI.
                </p>
            </div>
        </>
    );
};

export default MeetingPackPage;
