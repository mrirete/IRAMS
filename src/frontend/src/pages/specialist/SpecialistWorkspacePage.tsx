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
    TrendingUp, Gauge, Wrench, Radar, Route, Presentation,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import AdvisoryAgentPanel from '../../eam/components/ui/AdvisoryAgentPanel';
import { runSpecialist, runReliabilityDigest, runWeibullAnalyst, runRsaAnalyst, type AgentTurn } from '../../eam/services/agentRunClient';
import { predictionService, type AgentAction } from '../../eam/services/PredictionService';
import { computeRealization, type RealizationSummary } from '../../lib/valueRealization';
import { computeBriefingAnalytics, type BriefingAnalytics } from '../../lib/briefingCharts';
import { computeMissions, type DetMission } from '../../lib/missionEngine';
import { messagingService } from '../../eam/services/MessagingService';
import { analyzeService, type RCAInvestigation } from '../../eam/services/AnalyzeService';
import { Search, GitBranch, Target, HeartPulse, FolderOpen } from 'lucide-react';
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
    pm_optimizer: { label: 'PM schedules', path: '/recurring-work' },
    watchdog: { label: 'Analyze', path: '/analyze' },
    strategy_engine: { label: 'Assessment', path: '/specialist/assessment' },
};

/** Per-agent glyph so a long queue is scannable without reading every title. */
const AGENT_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    bad_actor_hunter: TrendingUp,
    threshold_adapter: Gauge,
    alert_to_wo: ClipboardList,
    weibull_analyst: Activity,
    pm_optimizer: Wrench,
    watchdog: Radar,
    strategy_engine: Route,
};

const SUGGESTED = [
    'Which asset is costing us the most?',
    "What's overdue right now?",
    'How risky is P-101?',
];

/** Intent chips (moved home from the Tier's Start·Home) — deterministic
 *  routes into the reliability loop; they work with the AI down. */
const INTENTS: { icon: React.ReactNode; label: string; hint: string; path: string }[] = [
    { icon: <Search size={14} />, label: 'Investigate a failure', hint: 'Start a root cause analysis', path: '/analyze/rca/new' },
    { icon: <TrendingUp size={14} />, label: 'Find my bad actors', hint: 'Pareto — what drives 80% of cost', path: '/analyze' },
    { icon: <Gauge size={14} />, label: 'Check asset health', hint: 'KPIs, Golden Spot & Success Rate', path: '/reliability-metrics' },
    { icon: <GitBranch size={14} />, label: 'Model reliability', hint: 'Weibull, RBD, Monte Carlo', path: '/reliability-modelling' },
    { icon: <Target size={14} />, label: 'Decide a strategy', hint: 'Fleet strategy verdicts + RCM logic', path: '/specialist/assessment' },
    { icon: <HeartPulse size={14} />, label: 'Predict & monitor', hint: 'Live health, sensors & setup guide', path: '/predict' },
];

/** The reliability loop — the Tier's spine, footer-linked from the desk. */
const LOOP = [
    { label: 'Measure', path: '/reliability-metrics' },
    { label: 'Diagnose', path: '/analyze' },
    { label: 'Model', path: '/reliability-modelling' },
    { label: 'Decide', path: '/rcm' },
    { label: 'Forecast', path: '/predict' },
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
    const chatCardRef = useRef<HTMLElement>(null);

    // ── ask-first hero (one brain: submits into the chat below) ──
    const [heroQ, setHeroQ] = useState('');
    // ── continue where you left off (open RCAs — the Tier's live threads) ──
    const [openRcas, setOpenRcas] = useState<RCAInvestigation[]>([]);

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
            // F4 — wins made visible: tell the asset's thread, where the crew
            // talks, that leadership just green-lit the work. Fire-and-forget.
            const p = proposals.find((x) => x.id === id);
            const tag = String((p?.draft_payload as Record<string, unknown> | undefined)?.asset_tag ?? '');
            if (p?.asset_id && user?.id) {
                const title = String((p.draft_payload as Record<string, unknown>)?.title
                    ?? (p.draft_payload as Record<string, unknown>)?.recommendation_type ?? p.action_type);
                void messagingService.postMessage({
                    threadType: 'asset',
                    threadId: p.asset_id,
                    body: `✅ Specialist proposal approved: "${title}" — delivery queued. This lands on ${tag || 'this asset'}'s plan; the value clock starts now.`,
                    senderId: user.id,
                    senderName: user?.username ?? 'Reliability Specialist',
                    threadLabel: tag || 'asset',
                }).catch(() => { /* the approval stands even if the note fails */ });
            }
            setProposals((prev) => prev.filter((x) => x.id !== id));
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
    const firstName = (user?.username || '').split(/[._\s]/)[0] || '';

    useEffect(() => {
        void analyzeService.getRCAInvestigations().then((rcas) =>
            setOpenRcas(rcas.filter((r) => r.status !== 'closed').slice(0, 3)));
    }, []);

    /** Data-poor tenant: nothing imported yet, so migration IS the primary
     *  action and its card leads the page; once real history exists it
     *  demotes to the page foot — the daily flow starts at the ask box. */
    const dataPoor = analytics != null
        && assetsByTag.size < 10
        && analytics.pareto.length === 0
        && analytics.monthly.every((m) => m.cost === 0);

    /** ONE data on-ramp, two jobs named plainly. The old layout offered
     *  "Import data" (header) and "Migration Center" (card) as siblings —
     *  but the wizard is phase 6 OF the migration, and two same-sounding
     *  buttons at the top of a buyer's first page is where trust erodes. */
    const migrationCard = (
        <div className={`${CARD} p-4`}>
            <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                    <Database size={16} />
                </div>
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-800">Bring your data in</div>
                    <div className="text-[11.5px] text-slate-500">From SAP PM, Maximo, MaintainX or any spreadsheet — pick the size of the move.</div>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Link to="/specialist/import"
                    className="rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50/40 px-3 py-2.5 transition-colors group">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                        <UploadCloud size={13} className="text-primary-600" /> Quick import
                        <ArrowRight size={12} className="text-slate-300 group-hover:text-primary-600 ml-auto transition-colors" />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">One CMMS export file — the Specialist maps it and you get an assessment in minutes.</div>
                </Link>
                <Link to="/admin/migration"
                    className="rounded-lg border border-slate-200 hover:border-primary-300 hover:bg-primary-50/40 px-3 py-2.5 transition-colors group">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-800">
                        <Database size={13} className="text-primary-600" /> Full migration
                        <ArrowRight size={12} className="text-slate-300 group-hover:text-primary-600 ml-auto transition-colors" />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">The Migration Center walks register, people, stock, schedules and history across in the right order.</div>
                </Link>
            </div>
        </div>
    );

    /** Hero submit: same governed brain — the answer lands in the chat panel. */
    const askHero = () => {
        const q = heroQ.trim();
        if (!q) return;
        setHeroQ('');
        void send(q);
        chatCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

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
                    {/* ONE primary action. "Import data" left the header — it read
                        as a sibling of the Migration Center while actually being a
                        subset of it; the single data on-ramp card below owns both
                        paths (and the wizard stays one click away in the sidebar). */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => navigate('/specialist/assessment')} className={`${BTN_PRIMARY} flex-1 sm:flex-none`}>
                            <BarChart2 size={14} /> Run assessment
                        </button>
                    </div>
                </div>
            </header>

            {/* Onboarding position: with nothing imported, migration IS the
                first move — it leads the page until real data exists. */}
            {dataPoor && migrationCard}

            {/* ── Value ledger ──
                 Two tiles, not four. "Awaiting review" and "Approved" were counts
                 of things the page already states a few hundred pixels lower — the
                 proposals panel names its own backlog and the Deliver button carries
                 the approved badge — so as tiles they spent the best real estate on
                 the page repeating themselves. What survives is the part nothing else
                 says: what the Specialist claims it found, and what actually landed.

                 And while both are empty the rail collapses to one line. A grid of
                 zeros above the fold is not a value story; it is four ways of saying
                 nothing has happened yet. */}
            {/* Tiles exist only when there are DOLLARS to show. Counts alone
                ("1 proposal, not yet costed" + an em-dash) are two boxes of
                nothing on the page's best real estate — until money lands,
                one slim line keeps the ledger concept alive and the page
                breathable. */}
            {!loading && ledger && ledger.valueIdentified <= 0 && (realized?.measuredToDate ?? 0) <= 0 && (realized?.assetsMeasured ?? 0) === 0 ? (
                <div className={`${CARD} px-4 py-3 text-[12.5px] text-slate-500`}>
                    {ledger.pending > 0
                        ? <>Value ledger: {ledger.pending} proposal{ledger.pending === 1 ? '' : 's'} awaiting review — approved work gets costed and measured here.</>
                        : <>Nothing on the value ledger yet — run a briefing or an assessment, and the proposals it drafts get costed here.</>}
                </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">
                <StatTile
                    /* green only when there IS money on the board — a green $0 overstates
                       the state, and "$0 across 1 proposals" reads as broken arithmetic
                       rather than as an uncosted draft. No estimate shows as no number. */
                    label="Value identified" tone={(ledger?.valueIdentified ?? 0) > 0 ? 'money' : 'default'} loading={loading}
                    value={ledger && ledger.valueIdentified > 0 ? formatCurrency(ledger.valueIdentified) : '—'}
                    sub={(() => {
                        const n = (ledger?.approved ?? 0) + (ledger?.pending ?? 0);
                        const plural = `proposal${n === 1 ? '' : 's'}`;
                        if (!ledger) return 'across 0 proposals';
                        return ledger.valueIdentified > 0 ? `across ${n} ${plural}` : `${n} ${plural}, not yet costed`;
                    })()}
                    icon={<BadgeDollarSign size={15} />}
                />
                <StatTile
                    /* Measured ≠ identified: before/after CM run-rate on approved
                       assets (30-day maturity). The renewal-slide number — the
                       full story prints from /specialist/roi. */
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
            )}

            {/* ── The heart of the page: ask-first, centered (the Tier's old
                 Start·Home look) — value reads first above, action starts here.
                 One question, ONE brain: submits into the governed chat below.
                 Intent chips route deterministically and work with the AI down. ── */}
            <div className="py-6 sm:py-10">
                <div className="max-w-2xl mx-auto text-center px-2">
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                        What do you want to achieve today{firstName ? `, ${firstName}` : ''}?
                    </h2>
                    <p className="mt-1.5 text-[12.5px] text-slate-400">Your Specialist answers from your own records — or jump straight to the work.</p>
                    <div className="mt-5 flex items-center gap-2 bg-white border border-slate-300 rounded-2xl shadow-sm px-4 py-1 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/15 transition-all">
                        <input
                            value={heroQ}
                            onChange={(e) => setHeroQ(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') askHero(); }}
                            placeholder='Ask anything — "why does P-101 keep failing?"'
                            className="flex-1 min-w-0 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                        />
                        <button onClick={askHero} disabled={!heroQ.trim()} aria-label="Ask the Specialist"
                            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 transition-colors">
                            <Send size={14} />
                        </button>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                        {INTENTS.map((i) => (
                            <button key={i.label} onClick={() => navigate(i.path)} title={i.hint}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-600 hover:border-primary-300 hover:text-primary-700 hover:shadow-sm transition-all">
                                <span className="text-slate-400">{i.icon}</span>{i.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* The doors row: renewal statement + weekly pack + (for established
                tenants) the compact data on-ramp — visible mid-page, never
                buried at the foot, never shouting at the top. */}
            <div className={`grid grid-cols-1 md:grid-cols-2 ${!dataPoor ? 'lg:grid-cols-3' : ''} gap-3`}>
                <Link to="/specialist/roi"
                    className={`${CARD} flex items-center gap-3 px-4 py-3 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors group`}>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                        <BadgeDollarSign size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800">Return on Reliability statement</div>
                        <div className="text-[11.5px] text-slate-500 mt-0.5 hidden sm:block">
                            Cost vs measured value — print it for the renewal conversation.
                        </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
                <Link to="/specialist/meeting"
                    className={`${CARD} flex items-center gap-3 px-4 py-3 hover:border-violet-300 hover:bg-violet-50/40 transition-colors group`}>
                    <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                        <Presentation size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800">Weekly meeting pack</div>
                        <div className="text-[11.5px] text-slate-500 mt-0.5 hidden sm:block">
                            Wins, stuck decisions, night-shift signals, the numbers — auto-drafted.
                        </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-300 group-hover:text-violet-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
                {!dataPoor && (
                    <div className={`${CARD} flex items-center gap-3 px-4 py-3`}>
                        <div className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                            <Database size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-slate-800">Bring your data in</div>
                            <div className="text-[11.5px] mt-0.5 flex items-center gap-2">
                                <Link to="/specialist/import" className="text-primary-600 hover:text-primary-700 hover:underline font-medium">Quick import</Link>
                                <span className="text-slate-300">·</span>
                                <Link to="/admin/migration" className="text-primary-600 hover:text-primary-700 hover:underline font-medium">Full migration</Link>
                            </div>
                        </div>
                    </div>
                )}
            </div>

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

                    {/* Root Success Analyst — PSC E4: positive deviance, the success-side RCA */}
                    <AdvisoryAgentPanel
                        title="Root Success Analyst"
                        subtitle="Why does the best asset in a class succeed — and how do we propagate it (PSC RSA)"
                        icon={<TrendingUp size={16} />}
                        accent="primary"
                        runLabel="Find success"
                        inputPlaceholder="Optional focus, e.g. a pump class or area"
                        onRun={(input) => runRsaAnalyst(input)}
                    />
                </div>

                {/* ── Right: conversation + work log ── */}
                <div className="space-y-4">
                    <section ref={chatCardRef} className={`${CARD} flex flex-col h-[26rem] lg:h-[32rem] overflow-hidden`}>
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

                    {/* Continue where you left off — the Tier's open threads, on the desk */}
                    {openRcas.length > 0 && (
                        <Panel title="Continue where you left off" icon={<FolderOpen size={14} />} bodyClass="">
                            <ul className="divide-y divide-slate-100">
                                {openRcas.map((r) => (
                                    <li key={r.id}>
                                        <button onClick={() => navigate(`/analyze/rca/${r.id}`)}
                                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50/70 transition-colors">
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-[12.5px] font-medium text-slate-700 truncate">{r.title}</span>
                                                <span className="block text-[10.5px] text-slate-400">RCA investigation · {r.status ?? 'draft'}</span>
                                            </span>
                                            <ChevronRight size={14} className="text-slate-300 shrink-0" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                    )}

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

            {/* The reliability loop — the practitioner's spine, one hop away. */}
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400 pt-1">
                {LOOP.map((s, i) => (
                    <React.Fragment key={s.label}>
                        {i > 0 && <span className="text-slate-300">→</span>}
                        <button onClick={() => navigate(s.path)}
                            className="px-1.5 py-0.5 rounded font-medium hover:text-primary-700 hover:bg-primary-50 transition-colors">
                            {s.label}
                        </button>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

export default SpecialistWorkspacePage;
