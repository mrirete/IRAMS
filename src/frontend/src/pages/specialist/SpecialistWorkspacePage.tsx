/**
 * SpecialistWorkspacePage — the Specialist's desk (Specialist Phase 1,
 * strategy §5.2: identity + briefing + proposals queue + conversation +
 * work log, consolidating the previously scattered agent panels).
 *
 * Reads: ers_ai_audit_log (admin SELECT, 0219) for the last briefing + work
 * log; ers_agent_actions for pending proposals. Writes: none except a human
 * dismissing a proposal — every apply stays in its owning module.
 *
 * Visual language (2026-07-27): flat white surfaces, hairline borders, one
 * blue for action, colour reserved for state. No marketing gradients — this
 * is a console an engineer sits in front of all day.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    Sparkles, Send, Loader2, ClipboardList, ScrollText, UploadCloud,
    BarChart2, RefreshCw, ChevronRight, X, BrainCircuit, Activity, BadgeDollarSign,
    Check, Database, ArrowRight, CheckCircle2, Copy,
    TrendingUp, Gauge,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import AdvisoryAgentPanel from '../../eam/components/ui/AdvisoryAgentPanel';
import { runSpecialist, runReliabilityDigest, runWeibullAnalyst, type AgentTurn } from '../../eam/services/agentRunClient';
import { predictionService, type AgentAction } from '../../eam/services/PredictionService';
import { computeRealization, type RealizationSummary } from '../../lib/valueRealization';
import { computeBriefingAnalytics, type BriefingAnalytics } from '../../lib/briefingCharts';
import { computeMissions, type DetMission } from '../../lib/missionEngine';
import BriefingReport, { RichText, type BriefingAsset } from '../../components/specialist/BriefingReport';

interface AuditRow {
    id: string; module: string; context_type: string; query_text: string;
    response_text: string; created_at: string; duration_ms: number | null;
}

/** Where a proposal type gets applied — the workspace links, never applies. */
const PROPOSAL_HOMES: Record<string, { label: string; path: string }> = {
    bad_actor_hunter: { label: 'Defect Elimination', path: '/analyze' },
    threshold_adapter: { label: 'Predict — Agent Review', path: '/predict' },
    alert_to_wo: { label: 'Predict — Agent Review', path: '/predict' },
};

/** Per-agent glyph so a long queue is scannable without reading every title. */
const AGENT_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    bad_actor_hunter: TrendingUp,
    threshold_adapter: Gauge,
    alert_to_wo: ClipboardList,
    weibull_analyst: Activity,
};

const SUGGESTED = [
    'Which asset is costing us the most?',
    "What's overdue right now?",
    'How risky is P-101?',
];

// ── shared control classes — one definition each, so every button on the page
//    lands on the same height, radius and hover behaviour ──
const BTN_PRIMARY =
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3.5 h-10 sm:h-9 text-[13px] font-semibold text-white ' +
    'transition-colors hover:bg-primary-700 active:bg-primary-800 disabled:opacity-45 disabled:pointer-events-none';
const BTN_GHOST =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 h-10 sm:h-9 text-[13px] font-semibold text-slate-700 ' +
    'transition-colors hover:bg-slate-50 hover:border-slate-300 disabled:opacity-45 disabled:pointer-events-none';
const CARD = 'rounded-xl border border-slate-200 bg-white';

const relTime = (iso: string): string => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
};

/** One KPI on the rail. Values are real reads — never a placeholder number. */
const StatTile: React.FC<{
    label: string;
    value: React.ReactNode;
    sub: string;
    icon: React.ReactNode;
    tone?: 'default' | 'money' | 'attention';
    loading?: boolean;
}> = ({ label, value, sub, icon, tone = 'default', loading }) => (
    <div className={`${CARD} p-3.5 sm:p-4`}>
        <div className="flex items-start justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-400 leading-tight">{label}</span>
            <span className="text-slate-300 shrink-0">{icon}</span>
        </div>
        {loading
            ? <div className="mt-2.5 h-6 w-20 skeleton-line" />
            : <div className={`mt-1.5 text-xl sm:text-[26px] font-semibold tabular-nums tracking-tight leading-none ${tone === 'money' ? 'text-emerald-700' : tone === 'attention' ? 'text-amber-600' : 'text-slate-900'
                }`}>{value}</div>}
        <div className="mt-1.5 text-[11px] text-slate-400 truncate">{sub}</div>
    </div>
);

/** Card shell: hairline header strip + body, used by every panel below. */
const Panel: React.FC<{
    title: string;
    icon: React.ReactNode;
    meta?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
    bodyClass?: string;
}> = ({ title, icon, meta, actions, children, bodyClass = 'p-4 sm:p-5' }) => (
    <section className={`${CARD} overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100">
            <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                    <span className="text-slate-400">{icon}</span>{title}
                </h2>
                {meta && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{meta}</div>}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        <div className={bodyClass}>{children}</div>
    </section>
);

export const SpecialistWorkspacePage: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatCurrency } = useSettings();

    // ── briefing ──
    const [briefing, setBriefing] = useState<AuditRow | null>(null);
    const [briefingLive, setBriefingLive] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [copied, setCopied] = useState(false);

    // ── entity linking: real register tags → interactive chips in briefing/chat ──
    const [assetsByTag, setAssetsByTag] = useState<Map<string, BriefingAsset>>(new Map());
    // ── live illustrations for the briefing (computed, never parsed from prose) ──
    const [analytics, setAnalytics] = useState<BriefingAnalytics | null>(null);
    // ── deterministic missions — the data marks them done, not the user ──
    const [missions, setMissions] = useState<DetMission[] | null>(null);

    // ── proposals ──
    const [proposals, setProposals] = useState<AgentAction[]>([]);
    const [dismissing, setDismissing] = useState<string | null>(null);
    const [approving, setApproving] = useState<string | null>(null);

    // ── work log ──
    const [log, setLog] = useState<AuditRow[]>([]);
    const [loading, setLoading] = useState(true);

    // ── value ledger (identified = draft estimates; measured = before/after
    //    CM run-rate on assets with approved actions, lib/valueRealization) ──
    const [ledger, setLedger] = useState<{ approved: number; pending: number; valueIdentified: number } | null>(null);
    const [realized, setRealized] = useState<RealizationSummary | null>(null);

    // ── chat ──
    const [msgs, setMsgs] = useState<AgentTurn[]>([]);
    const [input, setInput] = useState('');
    const [chatBusy, setChatBusy] = useState(false);
    const chatRef = useRef<HTMLDivElement>(null);

    /** estimated_savings (DE tasks) preferred; annual_cost as the stake proxy. */
    const draftValue = (a: AgentAction): number => {
        const p = (a.draft_payload ?? {}) as Record<string, unknown>;
        return Number(p.estimated_savings) || Number(p.annual_cost) || 0;
    };

    const loadAll = async () => {
        const [logQ, actionsQ, assetQ, woQ, overdueQ] = await Promise.all([
            supabase.from('ers_ai_audit_log')
                .select('id, module, context_type, query_text, response_text, created_at, duration_ms')
                .eq('action_type', 'agent_run')
                .order('created_at', { ascending: false })
                .limit(15),
            predictionService.getAgentActions(),
            supabase.from('assets').select('id, tag, name, criticality').limit(10000),
            supabase.from('work_orders')
                .select('asset_id, type, status, created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost')
                .order('created_at', { ascending: false })
                .limit(20000),
            // Same overdue definition the digest agent's tool uses.
            supabase.from('recurring_work')
                .select('id, asset_id')
                .eq('active', true)
                .lt('next_due_date', new Date().toISOString())
                .limit(5000),
        ]);
        const rows = (logQ.data ?? []) as AuditRow[];
        setLog(rows);
        const assetRows = (assetQ.data ?? []) as BriefingAsset[];
        setAssetsByTag(new Map(assetRows.map((a) => [a.tag.toLowerCase(), a])));
        const woRows = ((woQ.data ?? []) as Record<string, unknown>[]).map((w) => ({
            asset_id: (w.asset_id as string) ?? null,
            type: (w.type as string) ?? null,
            status: (w.status as string) ?? null,
            created_at: String(w.created_at),
            cost: ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0,
        }));
        const liveAnalytics = computeBriefingAnalytics(woRows, assetRows, Date.now());
        setAnalytics(liveAnalytics);

        // Deterministic missions: live counts in, verified "done" out. The
        // baseline is snapshotted per briefing so a cleared count renders as
        // a win instead of vanishing.
        const tagById = new Map(assetRows.map((a) => [a.id, a.tag]));
        const overduePmTags = [...new Set(((overdueQ.data ?? []) as { asset_id: string | null }[])
            .map((r) => (r.asset_id ? tagById.get(r.asset_id) : null))
            .filter((t): t is string => Boolean(t)))].slice(0, 3);
        const openStatuses = (s: string | null) => !['CLOSED', 'TECO', 'CANCELLED', 'CANCELED', 'COMPLETED'].includes(String(s ?? '').toUpperCase());
        const openByAsset = new Map<string, number>();
        for (const w of woRows) {
            if (w.asset_id && openStatuses(w.status)) openByAsset.set(w.asset_id, (openByAsset.get(w.asset_id) ?? 0) + 1);
        }
        const missionKey = `specialist-mission-baseline:${rows.find((r) => r.context_type === 'reliability_digest')?.created_at ?? 'none'}`;
        let prevBaseline: Record<string, number> | null = null;
        try { prevBaseline = JSON.parse(localStorage.getItem(missionKey) ?? 'null'); } catch { /* ignore */ }
        const computed = computeMissions({
            overduePmCount: (overdueQ.data ?? []).length,
            overduePmTags,
            topOpenAssets: liveAnalytics.pareto.slice(0, 3).map((p) => ({ tag: p.tag, open: openByAsset.get(p.assetId) ?? 0 })),
            pendingProposals: actionsQ.filter((a) => a.status === 'pending_review').length,
        }, prevBaseline);
        try { localStorage.setItem(missionKey, JSON.stringify(computed.baseline)); } catch { /* private mode */ }
        setMissions(computed.missions);
        setBriefing(rows.find((r) => r.context_type === 'reliability_digest') ?? null);
        setProposals(actionsQ.filter((a) => a.status === 'pending_review'));

        // Identified value: what the Specialist's proposals put on the table.
        setLedger({
            approved: actionsQ.filter((a) => a.status === 'approved').length,
            pending: actionsQ.filter((a) => a.status === 'pending_review').length,
            valueIdentified: actionsQ
                .filter((a) => a.status === 'approved' || a.status === 'pending_review')
                .reduce((s, a) => s + draftValue(a), 0),
        });
        setLoading(false);

        // Measured value: before/after corrective run-rate on the assets whose
        // proposals a human actually approved — the number that has to beat
        // the $150k engineer's annual-review slide.
        const approved = actionsQ.filter((a) => a.status === 'approved' && a.asset_id);
        if (approved.length === 0) { setRealized(computeRealization([], [], Date.now())); return; }
        const assetIds = [...new Set(approved.map((a) => a.asset_id as string))];
        const { data: realizationWoRows } = await supabase.from('work_orders')
            .select('asset_id, type, created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost')
            .in('asset_id', assetIds)
            .limit(20000);
        setRealized(computeRealization(
            approved.map((a) => ({ asset_id: a.asset_id, approved_at: a.reviewed_at ?? a.created_at })),
            (realizationWoRows ?? []).map((w: Record<string, unknown>) => ({
                asset_id: (w.asset_id as string) ?? null,
                type: (w.type as string) ?? null,
                created_at: String(w.created_at),
                cost: ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0,
            })),
            Date.now(),
        ));
    };
    useEffect(() => { void loadAll(); }, []);

    // Keep the transcript pinned to the newest turn.
    useEffect(() => {
        chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    }, [msgs, chatBusy]);

    const runBriefing = async () => {
        setRunning(true);
        try {
            const res = await runReliabilityDigest();
            setBriefingLive(res.answer);
            void loadAll();
        } catch (e) {
            setBriefingLive(`The briefing could not be produced right now (${e instanceof Error ? e.message : 'error'}).`);
        } finally {
            setRunning(false);
        }
    };

    const send = async (preset?: string) => {
        const text = (preset ?? input).trim();
        if (!text || chatBusy) return;
        setInput('');
        const history = [...msgs];
        setMsgs((m) => [...m, { role: 'user', text }]);
        setChatBusy(true);
        try {
            const res = await runSpecialist(text, history);
            setMsgs((m) => [...m, { role: 'model', text: res.answer }]);
        } catch (e) {
            setMsgs((m) => [...m, { role: 'model', text: `I hit an error: ${e instanceof Error ? e.message : String(e)}` }]);
        } finally {
            setChatBusy(false);
        }
    };

    const dismiss = async (id: string) => {
        setDismissing(id);
        try {
            await predictionService.updateAgentActionStatus(id, 'rejected', user?.username || user?.id || 'workspace', 'Dismissed from Specialist workspace');
            setProposals((p) => p.filter((x) => x.id !== id));
            void loadAll();
        } finally {
            setDismissing(null);
        }
    };

    /**
     * Approve = the human decision the whole governance model rests on. It marks
     * the proposal approved; delivering it to the customer's CMMS happens on the
     * Deliver page, which re-checks approval server-side before any egress.
     */
    const approve = async (id: string) => {
        setApproving(id);
        try {
            await predictionService.updateAgentActionStatus(id, 'approved', user?.username || user?.id || 'workspace', 'Approved in Specialist workspace');
            setProposals((p) => p.filter((x) => x.id !== id));
            void loadAll();
        } finally {
            setApproving(null);
        }
    };

    const briefingText = briefingLive ?? briefing?.response_text ?? null;
    const briefingWhen = briefingLive ? 'just now' : briefing ? relTime(briefing.created_at) : null;

    const copyBriefing = async () => {
        if (!briefingText) return;
        await navigator.clipboard.writeText(briefingText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    const lastRun = useMemo(() => (log.length ? relTime(log[0].created_at) : '—'), [log]);

    return (
        <div className="max-w-6xl mx-auto space-y-4 pb-24 animate-in fade-in duration-300">
            {/* ── Identity header — flat surface, blue reserved for the action ── */}
            <header className={`${CARD} p-4 sm:p-5`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-primary-600 text-white flex items-center justify-center shrink-0">
                            <BrainCircuit size={22} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-[17px] sm:text-xl font-semibold text-slate-900 tracking-tight">Reliability Specialist</h1>
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                                </span>
                            </div>
                            <p className="text-[12.5px] sm:text-[13px] text-slate-500 mt-1 leading-relaxed max-w-2xl">
                                Reads your maintenance history, runs the engineering analyses and drafts the work.
                                <span className="text-slate-700 font-medium"> You approve everything.</span>
                            </p>
                        </div>
                    </div>
                    {/* Both actions stay reachable on a phone — they used to be desktop-only. */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => navigate('/specialist/import')} className={`${BTN_GHOST} flex-1 sm:flex-none`}>
                            <UploadCloud size={14} /> Import data
                        </button>
                        <button onClick={() => navigate('/specialist/assessment')} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
                            <BarChart2 size={14} /> Run assessment
                        </button>
                    </div>
                </div>
            </header>

            {/* ── KPI rail — the ledger, promoted out of a side card so the numbers
                 that justify the Specialist read first ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile
                    /* green only when there IS money on the board — a green $0 overstates the state */
                    label="Value identified" tone={(ledger?.valueIdentified ?? 0) > 0 ? 'money' : 'default'} loading={loading}
                    value={ledger ? formatCurrency(ledger.valueIdentified) : '—'}
                    sub={`across ${(ledger?.approved ?? 0) + (ledger?.pending ?? 0)} proposals`}
                    icon={<BadgeDollarSign size={15} />}
                />
                <StatTile
                    label="Awaiting review" loading={loading}
                    tone={(ledger?.pending ?? 0) > 0 ? 'attention' : 'default'}
                    value={ledger?.pending ?? '—'} sub="needs your decision"
                    icon={<ClipboardList size={15} />}
                />
                <StatTile
                    label="Approved" loading={loading}
                    value={ledger?.approved ?? '—'} sub="queued for delivery"
                    icon={<CheckCircle2 size={15} />}
                />
                <StatTile
                    /* Measured ≠ identified: before/after CM run-rate on approved
                       assets (30-day maturity). The renewal-slide number. */
                    label="Value measured" loading={loading || realized === null}
                    tone={(realized?.measuredToDate ?? 0) > 0 ? 'money' : (realized?.measuredToDate ?? 0) < 0 ? 'attention' : 'default'}
                    value={realized && realized.assetsMeasured > 0 ? formatCurrency(realized.measuredToDate) : '—'}
                    sub={!realized || (realized.assetsMeasured === 0 && realized.assetsMaturing === 0)
                        ? 'measures 30 days after an approval'
                        : realized.assetsMeasured === 0
                            ? `${realized.assetsMaturing} asset${realized.assetsMaturing === 1 ? '' : 's'} maturing`
                            : realized.measuredToDate < 0
                                ? 'no measurable change yet'
                                : `Δ corrective run-rate · ${realized.assetsMeasured} asset${realized.assetsMeasured === 1 ? '' : 's'}${realized.assetsMaturing ? ` · ${realized.assetsMaturing} maturing` : ''}`}
                    icon={<TrendingUp size={15} />}
                />
            </div>

            {/* Coming off another CMMS? The full migration path lives under Admin
                (it isn't licence-gated), but this is where a new customer starts. */}
            <Link to="/admin/migration"
                className={`${CARD} flex items-center gap-3 px-4 py-3 hover:border-primary-300 hover:bg-primary-50/40 transition-colors group`}>
                <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                    <Database size={16} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800">Migrating from SAP PM, Maximo or MaintainX?</div>
                    <div className="text-[11.5px] text-slate-500 mt-0.5 hidden sm:block">
                        The Migration Center walks your register, people, stock, schedules and history across in the right order.
                    </div>
                </div>
                <ArrowRight size={16} className="text-slate-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all shrink-0" />
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* ── Left: briefing + proposals + analyst ── */}
                <div className="lg:col-span-2 space-y-4">
                    <Panel
                        title="Briefing"
                        icon={<Sparkles size={14} className="text-primary-600" />}
                        meta={briefingWhen ? `Generated ${briefingWhen}` : 'Not run yet'}
                        actions={<>
                            {briefingText && (
                                <button onClick={() => void copyBriefing()} title="Copy briefing"
                                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors">
                                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                </button>
                            )}
                            <button onClick={() => void runBriefing()} disabled={running} className={BTN_PRIMARY}>
                                {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                {briefingText ? 'Refresh' : 'Run briefing'}
                            </button>
                        </>}
                    >
                        {briefingText ? (
                            /* Interactive brief: sections, live asset-tag popovers,
                               and a mission list that routes into the owning modules. */
                            <BriefingReport
                                text={briefingText}
                                briefingKey={briefingLive ? 'live' : briefing?.created_at ?? 'none'}
                                assetsByTag={assetsByTag}
                                onAsk={(q) => void send(q)}
                                analytics={analytics}
                                formatCurrency={formatCurrency}
                                missions={missions}
                            />
                        ) : (
                            <div className="text-center py-6">
                                <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 mx-auto flex items-center justify-center">
                                    <Sparkles size={18} />
                                </div>
                                <p className="mt-3 text-[13px] font-semibold text-slate-700">No briefing yet</p>
                                <p className="mt-1 text-[12px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                                    Run the first one — the Specialist reviews the backlog, bad actors and integrity risk, then reports back with citations.
                                </p>
                            </div>
                        )}
                    </Panel>

                    <Panel
                        title="Proposals awaiting review"
                        icon={<ClipboardList size={14} />}
                        meta={proposals.length > 0 ? `${proposals.length} drafted, none applied without you` : 'Every agent draft lands here first'}
                        actions={<button onClick={() => navigate('/specialist/deliver')} className={BTN_GHOST}>
                            <Send size={13} /> Deliver<span className="hidden xs:inline">&nbsp;approved</span>
                            {(ledger?.approved ?? 0) > 0 && (
                                <span className="ml-0.5 rounded-full bg-primary-600 text-white text-[10px] font-bold px-1.5 min-w-[18px] text-center">{ledger?.approved}</span>
                            )}
                        </button>}
                        bodyClass=""
                    >
                        {proposals.length === 0 ? (
                            <div className="text-center py-10 px-5">
                                <div className="w-11 h-11 rounded-xl bg-slate-50 text-slate-300 mx-auto flex items-center justify-center">
                                    <CheckCircle2 size={18} />
                                </div>
                                <p className="mt-3 text-[13px] font-semibold text-slate-700">Queue is clear</p>
                                <p className="mt-1 text-[12px] text-slate-500">Proposals drafted by any agent land here for a human decision.</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {proposals.map((p) => {
                                    const payload = (p.draft_payload ?? {}) as Record<string, unknown>;
                                    const title = String(payload.title ?? payload.action ?? p.action_type ?? 'Proposal');
                                    const home = PROPOSAL_HOMES[String(p.agent_type)] ?? { label: 'owning module', path: '/' };
                                    const Icon = AGENT_ICON[String(p.agent_type)] ?? Sparkles;
                                    const value = draftValue(p);
                                    const busy = approving === p.id || dismissing === p.id;
                                    return (
                                        <li key={p.id} className="px-4 sm:px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                                            <div className="flex items-start gap-3">
                                                <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0 mt-0.5">
                                                    <Icon size={15} />
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[13.5px] font-medium text-slate-900 leading-snug">{title}</div>
                                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                                                        <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 font-medium">
                                                            {String(p.agent_type).replaceAll('_', ' ')}
                                                        </span>
                                                        <span className="text-slate-400">{relTime(p.created_at)}</span>
                                                        {value > 0 && (
                                                            <span className="font-semibold text-emerald-700 tabular-nums">{formatCurrency(value)}/yr</span>
                                                        )}
                                                        <button onClick={() => navigate(home.path)}
                                                            title={`Open the full context in ${home.label}`}
                                                            className="hidden sm:inline-flex items-center gap-0.5 text-slate-400 hover:text-primary-600 font-medium">
                                                            {home.label} <ChevronRight size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                                {/* Desktop: inline actions. Mobile: full-width row below. */}
                                                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                                                    <button onClick={() => void approve(p.id)} disabled={busy}
                                                        title="Approve — queues this for delivery to your CMMS"
                                                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold px-2.5 h-8 disabled:opacity-50 transition-colors">
                                                        {approving === p.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                                                    </button>
                                                    <button onClick={() => void dismiss(p.id)} disabled={busy} title="Dismiss proposal"
                                                        className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors">
                                                        {dismissing === p.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="sm:hidden mt-3 flex gap-2">
                                                <button onClick={() => void approve(p.id)} disabled={busy}
                                                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 active:bg-emerald-700 text-white text-[13px] font-semibold h-10 disabled:opacity-50">
                                                    {approving === p.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Approve
                                                </button>
                                                <button onClick={() => navigate(home.path)}
                                                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 text-[13px] font-semibold h-10 px-3">
                                                    Review
                                                </button>
                                                <button onClick={() => void dismiss(p.id)} disabled={busy} aria-label="Dismiss proposal"
                                                    className="w-11 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 active:bg-rose-50 active:text-rose-600 h-10 disabled:opacity-50">
                                                    {dismissing === p.id ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Panel>

                    {/* Weibull Analyst — Tier-2: proposals it drafts land in the queue above */}
                    <AdvisoryAgentPanel
                        title="Weibull Analyst"
                        subtitle="Censored Weibull fit + statistically defensible PM basis for one asset"
                        icon={<Activity size={16} />}
                        accent="primary"
                        runLabel="Analyse asset"
                        inputPlaceholder="Asset tag, e.g. P-101"
                        onRun={(input) => runWeibullAnalyst(input.trim())}
                    />
                </div>

                {/* ── Right: conversation + work log ── */}
                <div className="space-y-4">
                    <section className={`${CARD} flex flex-col h-[26rem] lg:h-[32rem] overflow-hidden`}>
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 shrink-0">
                            <Sparkles size={14} className="text-primary-600" />
                            <h2 className="text-[13px] font-semibold text-slate-900">Ask the Specialist</h2>
                        </div>

                        <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
                            {msgs.length === 0 && (
                                <div className="space-y-3">
                                    <p className="text-[12px] text-slate-500 leading-relaxed">
                                        Ask anything about your fleet — it answers from your own records and cites what it used.
                                    </p>
                                    <div className="flex flex-col gap-1.5">
                                        {SUGGESTED.map((q) => (
                                            <button key={q} onClick={() => void send(q)}
                                                className="text-left text-[12px] text-slate-600 rounded-lg border border-slate-200 px-2.5 py-2 hover:border-primary-300 hover:bg-primary-50/50 hover:text-primary-700 transition-colors">
                                                {q}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {msgs.map((m, i) => (
                                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                                    <div className={`text-[13px] rounded-xl px-3 py-2 leading-relaxed max-w-[90%] ${m.role === 'user'
                                        ? 'bg-primary-600 text-white rounded-br-sm whitespace-pre-wrap'
                                        : 'bg-slate-50 border border-slate-200 text-slate-700 rounded-bl-sm'}`}>
                                        {m.role === 'user'
                                            ? m.text
                                            /* Model turns get the same treatment as the briefing:
                                               markdown rendered, asset tags → live popovers. */
                                            : <RichText text={m.text} assetsByTag={assetsByTag} onAsk={(q) => void send(q)} />}
                                    </div>
                                </div>
                            ))}
                            {chatBusy && (
                                <div className="flex items-center gap-2 text-[12px] text-slate-400">
                                    <Loader2 size={13} className="animate-spin" /> Thinking…
                                </div>
                            )}
                        </div>

                        <div className="p-2.5 border-t border-slate-100 flex gap-2 shrink-0">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                                placeholder="Ask about your assets…"
                                className="flex-1 min-w-0 rounded-lg border border-slate-200 px-3 h-10 text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15"
                            />
                            <button onClick={() => void send()} disabled={chatBusy || !input.trim()} aria-label="Send"
                                className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-lg bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white disabled:opacity-40 disabled:pointer-events-none transition-colors">
                                <Send size={15} />
                            </button>
                        </div>
                    </section>

                    <Panel title="Work log" icon={<ScrollText size={14} />}
                        meta={log.length ? `Every agent run, audited · last activity ${lastRun}` : 'Every agent run, audited'} bodyClass="">
                        {log.length === 0 ? (
                            <p className="text-[12px] text-slate-400 px-4 sm:px-5 py-5 text-center">
                                No agent runs recorded yet (admin access required to view the log).
                            </p>
                        ) : (
                            <div className="max-h-80 overflow-y-auto px-4 sm:px-5 py-2">
                                {log.map((r) => (
                                    <div key={r.id} className="relative pl-4 py-2 border-l border-slate-200 last:border-l-transparent">
                                        <span className="absolute -left-[3.5px] top-3.5 w-1.5 h-1.5 rounded-full bg-slate-300" />
                                        <div className="text-[12px] font-semibold text-slate-700 capitalize">{r.context_type.replaceAll('_', ' ')}</div>
                                        <div className="text-[11px] text-slate-500 truncate" title={r.query_text}>{r.query_text}</div>
                                        <div className="text-[10.5px] text-slate-400 mt-0.5 tabular-nums">
                                            {relTime(r.created_at)}{r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>
                </div>
            </div>
        </div>
    );
};

export default SpecialistWorkspacePage;
