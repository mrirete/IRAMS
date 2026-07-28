/**
 * RoiStatementPage — "Return on Reliability" (Phase C3,
 * docs/Specialist-150k-Replacement-Plan.md).
 *
 * The renewal artifact: what the Specialist cost vs what it measurably did,
 * printable like the assessment. The discipline is the same as everywhere
 * else — measured value (before/after CM run-rate, lib/valueRealization) is
 * NEVER mixed with identified value (draft estimates), and both sit beside
 * the plant-level corroboration (assessment-snapshot trend). No number on
 * this page is estimated by AI.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Printer, Loader2, BadgeDollarSign, TrendingUp, ShieldCheck,
    ClipboardList, Scale, Layers,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useSettings } from '../../contexts/SettingsContext';
import { predictionService } from '../../eam/services/PredictionService';
import { computeRealization, type RealizationSummary } from '../../lib/valueRealization';
import type { AssessmentSnapshot } from '../../eam/services/assessmentSnapshotService';

const SUB_KEY = 'specialist-subscription-monthly';
const ENGINEER_ANNUAL = 150_000;

interface RoiData {
    baseline: AssessmentSnapshot | null;
    latest: AssessmentSnapshot | null;
    snapshotCount: number;
    approved: number;
    pending: number;
    valueIdentified: number;
    realization: RealizationSummary;
    firstApprovalAt: string | null;
    assetLabel: Map<string, string>;
}

async function loadRoi(): Promise<RoiData> {
    const [snapQ, actions, assetQ] = await Promise.all([
        supabase.from('ers_assessment_snapshots')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(1000),
        predictionService.getAgentActions(),
        supabase.from('assets').select('id, tag, name').limit(10000),
    ]);
    const snaps = (snapQ.data ?? []) as AssessmentSnapshot[];
    const assetLabel = new Map(
        ((assetQ.data ?? []) as { id: string; tag: string; name: string }[]).map((a) => [a.id, `${a.tag} · ${a.name}`]),
    );

    const draftValue = (a: { draft_payload: Record<string, unknown> }) =>
        Number(a.draft_payload?.estimated_savings) || Number(a.draft_payload?.annual_cost) || 0;
    const approvedActions = actions.filter((a) => a.status === 'approved');
    const pendingActions = actions.filter((a) => a.status === 'pending_review');

    let realization = computeRealization([], [], Date.now());
    const withAssets = approvedActions.filter((a) => a.asset_id);
    if (withAssets.length > 0) {
        const assetIds = [...new Set(withAssets.map((a) => a.asset_id as string))];
        const { data: wos } = await supabase.from('work_orders')
            .select('asset_id, type, created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost')
            .in('asset_id', assetIds)
            .limit(20000);
        realization = computeRealization(
            withAssets.map((a) => ({ asset_id: a.asset_id, approved_at: a.reviewed_at ?? a.created_at })),
            ((wos ?? []) as Record<string, unknown>[]).map((w) => ({
                asset_id: (w.asset_id as string) ?? null,
                type: (w.type as string) ?? null,
                created_at: String(w.created_at),
                cost: ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0,
            })),
            Date.now(),
        );
    }

    const approvalDates = approvedActions
        .map((a) => a.reviewed_at ?? a.created_at)
        .filter(Boolean)
        .sort();

    return {
        baseline: snaps[0] ?? null,
        latest: snaps.length > 1 ? snaps[snaps.length - 1] : null,
        snapshotCount: snaps.length,
        approved: approvedActions.length,
        pending: pendingActions.length,
        valueIdentified: [...approvedActions, ...pendingActions].reduce((s, a) => s + draftValue(a), 0),
        realization,
        firstApprovalAt: approvalDates[0] ?? null,
        assetLabel,
    };
}

export const RoiStatementPage: React.FC = () => {
    const navigate = useNavigate();
    const { formatCurrency } = useSettings();
    const [data, setData] = useState<RoiData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [monthly, setMonthly] = useState<number>(() => {
        const v = Number(localStorage.getItem(SUB_KEY));
        return Number.isFinite(v) && v > 0 ? v : 2000;
    });

    useEffect(() => {
        loadRoi().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, []);

    const setSub = (v: number) => {
        setMonthly(v);
        try { localStorage.setItem(SUB_KEY, String(v)); } catch { /* private mode */ }
    };

    const periodFrom = data?.baseline ? String(data.baseline.created_at).slice(0, 10) : null;
    const annualSub = monthly * 12;
    const measured = data?.realization.measuredToDate ?? 0;
    const roiMultiple = useMemo(() => {
        if (!data || annualSub <= 0 || measured <= 0 || !data.firstApprovalAt) return null;
        // Cost accrued over the measurement window, not a full year: honest
        // denominator for a program that started weeks ago.
        const days = Math.max(1, (Date.now() - new Date(data.firstApprovalAt).getTime()) / 86_400_000);
        const costToDate = (annualSub / 365) * days;
        return Math.round((measured / costToDate) * 10) / 10;
    }, [data, annualSub, measured]);

    if (error) {
        return <div className="max-w-xl mx-auto mt-20 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-800 text-sm">{error}</div>;
    }
    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <Loader2 size={28} className="animate-spin text-primary-600" />
                <p className="text-sm">Compiling the value record…</p>
            </div>
        );
    }

    const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 print:border-0 print:p-0 print:mb-6 break-inside-avoid">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800 uppercase tracking-wide mb-4">{icon}{title}</h2>
            {children}
        </section>
    );

    const delta = (cur: number | null, base: number | null) =>
        cur == null || base == null ? null : cur - base;
    const regDelta = delta(data.latest?.register_health_pct ?? null, data.baseline?.register_health_pct ?? null);

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

            <div className="max-w-4xl mx-auto space-y-5 pb-24">
                {/* Cover */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden print:rounded-none print:border-0">
                    <div className="h-1 bg-emerald-600 print:hidden" />
                    <div className="p-6 sm:p-8">
                        <p className="text-emerald-700 text-[11px] font-bold uppercase tracking-[0.12em]">Return on Reliability</p>
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight mt-1.5">
                            What your Specialist has earned
                        </h1>
                        <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                            {periodFrom
                                ? <>Value record since the baseline assessment of {periodFrom} · {data.snapshotCount} assessment snapshot{data.snapshotCount === 1 ? '' : 's'} on file</>
                                : 'No baseline assessment yet — run one to open the value record.'}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-6 bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                            {[
                                {
                                    label: 'Value measured', value: data.realization.assetsMeasured > 0 ? formatCurrency(measured) : '—',
                                    sub: data.realization.assetsMeasured > 0
                                        ? `Δ corrective run-rate · ${data.realization.assetsMeasured} asset${data.realization.assetsMeasured === 1 ? '' : 's'}`
                                        : data.realization.assetsMaturing > 0 ? `${data.realization.assetsMaturing} maturing (30-day window)` : 'measures 30 days after an approval',
                                },
                                { label: 'Value identified', value: formatCurrency(data.valueIdentified), sub: `across ${data.approved + data.pending} proposals` },
                                { label: 'Decisions delivered', value: String(data.approved), sub: 'proposals approved by a human' },
                                {
                                    label: 'Register health', value: data.latest?.register_health_pct != null ? `${data.latest.register_health_pct}%` : data.baseline?.register_health_pct != null ? `${data.baseline.register_health_pct}%` : '—',
                                    sub: regDelta != null && regDelta !== 0 ? `${regDelta > 0 ? '▲' : '▼'} ${Math.abs(regDelta)} pts since baseline` : 'since baseline',
                                },
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

                {/* Cost vs value */}
                <Section icon={<Scale size={15} className="text-emerald-600" />} title="What it costs vs what it returns">
                    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                        <div>
                            <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Your subscription</div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-semibold text-slate-900 tabular-nums">{formatCurrency(annualSub)}</span>
                                <span className="text-[11px] text-slate-400">/yr</span>
                            </div>
                            <label className="no-print mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                                monthly
                                <input
                                    type="number" min={0} value={monthly}
                                    onChange={(e) => setSub(Number(e.target.value) || 0)}
                                    className="w-24 rounded-md border border-slate-200 px-2 py-1 text-[12px] tabular-nums focus:outline-none focus:border-primary-400"
                                />
                            </label>
                        </div>
                        <div>
                            <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">A staff reliability engineer</div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-2xl font-semibold text-slate-400 tabular-nums line-through decoration-slate-300">{formatCurrency(ENGINEER_ANNUAL)}</span>
                                <span className="text-[11px] text-slate-400">/yr + burden</span>
                            </div>
                            <div className="text-[11px] text-emerald-700 font-semibold mt-1.5">
                                {Math.round((1 - annualSub / ENGINEER_ANNUAL) * 100)}% below the salary line
                            </div>
                        </div>
                        {roiMultiple != null && (
                            <div>
                                <div className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Measured return to date</div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-2xl font-semibold text-emerald-700 tabular-nums">{roiMultiple}×</span>
                                    <span className="text-[11px] text-slate-400">vs cost accrued over the measurement window</span>
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-4">
                        Measured value is the change in corrective run-rate on assets whose Specialist proposals a human approved
                        (30-day maturity, one count per asset, negatives included). Identified value is the proposals' own estimates
                        and is reported separately — it is a pipeline, not a result.
                    </p>
                </Section>

                {/* Per-asset measured record */}
                <Section icon={<TrendingUp size={15} className="text-indigo-500" />} title="The measured record, asset by asset">
                    {data.realization.perAsset.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">
                            Nothing measured yet{data.realization.assetsMaturing > 0 ? ` — ${data.realization.assetsMaturing} asset${data.realization.assetsMaturing === 1 ? ' is' : 's are'} inside the 30-day maturity window` : ' — approve a proposal to start the clock'}.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                        <th className="py-2 pr-3">Asset</th><th className="py-2 pr-3">Approved</th>
                                        <th className="py-2 pr-3 text-right">CM rate before (/yr)</th>
                                        <th className="py-2 pr-3 text-right">CM rate after (/yr)</th>
                                        <th className="py-2 text-right">Measured to date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.realization.perAsset.map((p) => (
                                        <tr key={p.assetId} className="border-b border-slate-100">
                                            <td className="py-2 pr-3 font-semibold text-slate-700">{data.assetLabel.get(p.assetId) ?? `${p.assetId.slice(0, 8)}…`}</td>
                                            <td className="py-2 pr-3 text-slate-500">{p.approvedAt.slice(0, 10)} · {p.elapsedDays}d ago</td>
                                            <td className="py-2 pr-3 text-right font-mono">{formatCurrency(p.beforeAnnualRate)}</td>
                                            <td className="py-2 pr-3 text-right font-mono">{formatCurrency(p.afterAnnualRate)}</td>
                                            <td className={`py-2 text-right font-mono font-semibold ${p.measuredToDate >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatCurrency(p.measuredToDate)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Section>

                {/* Plant-level corroboration */}
                <Section icon={<Layers size={15} className="text-sky-600" />} title="Plant-level corroboration — the assessment trend">
                    {!data.baseline ? (
                        <p className="text-sm text-slate-400 italic">Run the first assessment to record the baseline.</p>
                    ) : !data.latest ? (
                        <p className="text-sm text-slate-500">Baseline recorded {periodFrom}. The trend row unlocks on the next assessment run (they persist at most once per 12 hours).</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                        <th className="py-2 pr-3" /><th className="py-2 pr-3 text-right">Baseline · {periodFrom}</th>
                                        <th className="py-2 pr-3 text-right">Latest · {String(data.latest.created_at).slice(0, 10)}</th>
                                        <th className="py-2 text-right">Δ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { label: 'Maintenance spend (12 mo)', b: data.baseline.total_spend_12mo, l: data.latest.total_spend_12mo, fmt: formatCurrency, goodDown: true },
                                        { label: 'Register health', b: data.baseline.register_health_pct, l: data.latest.register_health_pct, fmt: (n: number) => `${n}%`, goodDown: false },
                                        { label: 'Failure-code coverage', b: data.baseline.coverage_failure_pct, l: data.latest.coverage_failure_pct, fmt: (n: number) => `${n}%`, goodDown: false },
                                        { label: 'Warranty recoverable found', b: data.baseline.warranty_recoverable, l: data.latest.warranty_recoverable, fmt: formatCurrency, goodDown: false },
                                    ].map((r) => {
                                        const d = delta(r.l == null ? null : Number(r.l), r.b == null ? null : Number(r.b));
                                        const good = d != null && d !== 0 && (r.goodDown ? d < 0 : d > 0);
                                        return (
                                            <tr key={r.label} className="border-b border-slate-100">
                                                <td className="py-2 pr-3 text-slate-600">{r.label}</td>
                                                <td className="py-2 pr-3 text-right font-mono">{r.b == null ? '—' : r.fmt(Number(r.b))}</td>
                                                <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-800">{r.l == null ? '—' : r.fmt(Number(r.l))}</td>
                                                <td className={`py-2 text-right font-mono ${d == null || d === 0 ? 'text-slate-400' : good ? 'text-emerald-700' : 'text-rose-600'}`}>
                                                    {d == null ? '—' : d === 0 ? 'unchanged' : `${d > 0 ? '▲' : '▼'} ${r.fmt(Math.abs(d))}`}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <p className="text-[10.5px] text-slate-400 mt-2">
                                Spend rows are trailing-12-month windows: they also move as old history ages out, so treat the spend Δ as
                                directional corroboration — the per-asset measured record above is the attribution-safe number.
                            </p>
                        </div>
                    )}
                </Section>

                {/* Governance strip */}
                <Section icon={<ClipboardList size={15} className="text-slate-500" />} title="Governance">
                    <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-600">
                        <span><span className="font-semibold text-slate-800 tabular-nums">{data.approved}</span> proposals approved by a human</span>
                        <span><span className="font-semibold text-slate-800 tabular-nums">{data.pending}</span> awaiting review</span>
                        <span><span className="font-semibold text-slate-800 tabular-nums">{data.snapshotCount}</span> assessment snapshots (append-only)</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
                        <ShieldCheck size={12} /> Every outward action required a human approval; every number above is computed from your records — nothing on this page is estimated by AI.
                    </p>
                </Section>

                <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1.5">
                    <BadgeDollarSign size={11} /> IRAMS · Reliability Specialist by Relantern — Return on Reliability statement, generated {new Date().toISOString().slice(0, 10)}.
                </p>
            </div>
        </>
    );
};

export default RoiStatementPage;
