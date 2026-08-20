/**
 * DeliverWorkPage — the outbound half of the Specialist loop (Phase 3).
 *
 * Approved proposals leave here two ways: as a CMMS-shaped export package the
 * customer bulk-imports (always available), or delivered live to a configured
 * endpoint via the proposal-writeback function. Both render from the same
 * unit-tested normalizer in lib/writebackPackage.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Download, Send, Loader2, AlertTriangle, CheckCircle2,
    Plus, Radio, FileSpreadsheet, ClipboardList, History, X,
} from 'lucide-react';
import {
    buildPackage, toCsv, TARGET_LABELS,
    type TargetSystem, type ApprovedProposal, type AssetRef,
} from '../../lib/writebackPackage';
import {
    writebackService, type WritebackTarget, type DeliveryLogRow, type DeliveryResult,
} from '../../eam/services/WritebackService';
import { exportXLSX } from '../../eam/utils/reportExport';

const SYSTEMS: TargetSystem[] = ['generic', 'sap_pm', 'maximo', 'maintainx'];

export const DeliverWorkPage: React.FC = () => {
    const navigate = useNavigate();

    const [proposals, setProposals] = useState<ApprovedProposal[]>([]);
    const [assets, setAssets] = useState<AssetRef[]>([]);
    const [targets, setTargets] = useState<WritebackTarget[]>([]);
    const [deliveries, setDeliveries] = useState<DeliveryLogRow[]>([]);
    const [loading, setLoading] = useState(true);

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [system, setSystem] = useState<TargetSystem>('generic');
    const [targetId, setTargetId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<DeliveryResult | null>(null);
    const [showAddTarget, setShowAddTarget] = useState(false);

    const load = async () => {
        setLoading(true);
        const [p, a, t, d] = await Promise.all([
            writebackService.getApprovedProposals(),
            writebackService.getAssetRefs(),
            writebackService.listTargets(),
            writebackService.listDeliveries(15),
        ]);
        setProposals(p);
        setAssets(a);
        setTargets(t);
        setDeliveries(d);
        setSelected(new Set(p.map((x) => x.id))); // default: everything approved
        setLoading(false);
    };
    useEffect(() => { void load(); }, []);

    const selectedProposals = useMemo(
        () => proposals.filter((p) => selected.has(p.id)),
        [proposals, selected],
    );
    const pkg = useMemo(
        () => buildPackage(selectedProposals, assets, system),
        [selectedProposals, assets, system],
    );

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const downloadCsv = () => {
        const blob = new Blob([toCsv(pkg)], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `specialist-work-${system}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadXlsx = async () => {
        await exportXLSX(
            pkg.rows,
            pkg.columns.map((c) => ({ key: c, label: c })),
            `specialist-work-${system}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
    };

    const deliver = async (dryRun: boolean) => {
        if (!targetId) { setError('Choose a delivery target first.'); return; }
        setBusy(true); setError(null); setResult(null);
        try {
            const res = await writebackService.deliver(targetId, pkg.actions, dryRun);
            setResult(res);
            if (!dryRun) await load();
            else setDeliveries(await writebackService.listDeliveries(15));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-500">
                <Loader2 size={26} className="animate-spin text-primary-600" />
                <p className="text-sm">Loading approved work…</p>
            </div>
        );
    }

    return (
        <div className="ers-page-form space-y-5 pb-24 animate-in fade-in duration-300">
            <div>
                <button onClick={() => navigate('/specialist')}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
                    <ArrowLeft size={15} /> Specialist workspace
                </button>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Send size={20} className="text-primary-600" /> Deliver work to your CMMS
                </h1>
                <p className="text-slate-500 text-sm mt-1">
                    Work you approved, shaped for the system you actually run. Download a package to import,
                    or deliver it live where your CMMS has an API.
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {proposals.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
                    <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
                    <h2 className="text-sm font-semibold text-slate-700">Nothing approved yet</h2>
                    <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                        Your Specialist drafts work, but a human approves it. Review the proposals queue in the
                        workspace — approved items appear here ready to send.
                    </p>
                    <button onClick={() => navigate('/specialist')}
                        className="mt-4 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 transition-colors">
                        Go to the proposals queue
                    </button>
                </div>
            ) : (
                <>
                    {/* Selection */}
                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-slate-800">
                                Approved work <span className="text-slate-400 font-normal">({selected.size} of {proposals.length} selected)</span>
                            </h2>
                            <div className="flex gap-2 text-xs">
                                <button onClick={() => setSelected(new Set(proposals.map((p) => p.id)))}
                                    className="text-primary-600 hover:text-primary-800 font-medium">Select all</button>
                                <button onClick={() => setSelected(new Set())}
                                    className="text-slate-400 hover:text-slate-600 font-medium">Clear</button>
                            </div>
                        </div>
                        <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                            {proposals.map((p) => {
                                const payload = (p.draft_payload ?? {}) as Record<string, unknown>;
                                const title = String(payload.title ?? payload.basis ?? p.action_type);
                                return (
                                    <label key={p.id} className="flex items-start gap-3 py-2.5 cursor-pointer">
                                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                                            className="mt-1 accent-primary-600" />
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm text-slate-700 truncate">{title}</div>
                                            <div className="text-[11px] text-slate-400">
                                                {String(p.agent_type).replaceAll('_', ' ')} · approved {new Date(p.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </section>

                    {/* Package preview */}
                    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <FileSpreadsheet size={15} className="text-emerald-600" /> Export package
                            </h2>
                            <label className="flex items-center gap-2 text-xs ml-auto">
                                <span className="text-slate-500">Shape for</span>
                                <select value={system} onChange={(e) => setSystem(e.target.value as TargetSystem)}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700">
                                    {SYSTEMS.map((s) => <option key={s} value={s}>{TARGET_LABELS[s]}</option>)}
                                </select>
                            </label>
                            <button onClick={downloadCsv} disabled={pkg.rows.length === 0}
                                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-2 disabled:opacity-40">
                                <Download size={13} /> CSV
                            </button>
                            <button onClick={() => void downloadXlsx()} disabled={pkg.rows.length === 0}
                                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 disabled:opacity-40">
                                <Download size={13} /> Excel
                            </button>
                        </div>

                        {pkg.rows.length === 0 ? (
                            <p className="text-sm text-slate-400 italic">Select at least one item to build a package.</p>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-100">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50">
                                        <tr>{pkg.columns.map((c) => (
                                            <th key={c} className="text-left font-semibold text-slate-500 px-3 py-2 whitespace-nowrap">{c}</th>
                                        ))}</tr>
                                    </thead>
                                    <tbody>
                                        {pkg.rows.slice(0, 4).map((r, i) => (
                                            <tr key={i} className="border-t border-slate-100">
                                                {pkg.columns.map((c) => (
                                                    <td key={c} className="px-3 py-2 text-slate-600 max-w-[16rem] truncate" title={String(r[c] ?? '')}>
                                                        {String(r[c] ?? '')}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {pkg.rows.length > 4 && (
                                    <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100">
                                        + {pkg.rows.length - 4} more row(s) in the download
                                    </div>
                                )}
                            </div>
                        )}

                        {pkg.notes.map((n, i) => (
                            <p key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-500" />{n}
                            </p>
                        ))}
                    </section>

                    {/* Live delivery */}
                    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                <Radio size={15} className="text-primary-600" /> Live delivery
                            </h2>
                            <button onClick={() => setShowAddTarget((v) => !v)}
                                className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-800">
                                <Plus size={13} /> Add target
                            </button>
                        </div>

                        {showAddTarget && <AddTargetForm onDone={async () => { setShowAddTarget(false); setTargets(await writebackService.listTargets()); }} />}

                        {targets.length === 0 ? (
                            <p className="text-sm text-slate-400 italic">
                                No delivery target configured. Add one to push work straight into your CMMS — or just use the export package above,
                                which needs nothing from your IT team.
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                                        className="rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-700 text-sm">
                                        <option value="">Choose a target…</option>
                                        {targets.map((t) => (
                                            <option key={t.id} value={t.id}>
                                                {t.name} · {TARGET_LABELS[t.system as TargetSystem] ?? t.system}{t.is_active ? '' : ' (inactive)'}
                                            </option>
                                        ))}
                                    </select>
                                    <button onClick={() => void deliver(true)} disabled={busy || !targetId || pkg.actions.length === 0}
                                        className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-xs font-semibold px-3 py-2 disabled:opacity-40">
                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Dry run
                                    </button>
                                    <button onClick={() => void deliver(false)} disabled={busy || !targetId || pkg.actions.length === 0}
                                        className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2 disabled:opacity-40 transition-colors">
                                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Deliver {pkg.actions.length} item(s)
                                    </button>
                                </div>
                                <p className="text-[11px] text-slate-400">
                                    A dry run builds and logs the exact payload without sending it. Each item is delivered to a target only once —
                                    approval is re-checked on the server, so nothing unapproved can leave.
                                </p>
                            </>
                        )}

                        {result && (
                            <div className={`rounded-xl border px-4 py-3 text-sm ${result.failed > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                                <div className="font-semibold">
                                    {result.dry_run ? 'Dry run complete' : 'Delivery complete'} — {result.sent} sent, {result.failed} failed, {result.skipped} skipped
                                </div>
                                {result.warning && <div className="text-xs mt-1">{result.warning}</div>}
                                {result.results.filter((r) => r.reason || r.error).slice(0, 5).map((r) => (
                                    <div key={r.proposal_id} className="text-xs mt-1">• {r.reason ?? r.error}</div>
                                ))}
                            </div>
                        )}
                    </section>
                </>
            )}

            {deliveries.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
                        <History size={15} className="text-slate-400" /> Recent deliveries
                    </h2>
                    <div className="divide-y divide-slate-100">
                        {deliveries.map((d) => (
                            <div key={d.id} className="py-2 flex items-center gap-3 text-xs">
                                <span className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full text-[10px] ${d.status === 'sent' ? 'bg-emerald-50 text-emerald-600'
                                    : d.status === 'failed' ? 'bg-rose-50 text-rose-600'
                                        : 'bg-slate-100 text-slate-500'}`}>{d.status}</span>
                                <span className="text-slate-500 font-mono truncate max-w-[12rem]">{d.proposal_id.slice(0, 8)}</span>
                                {d.http_status && <span className="text-slate-400">HTTP {d.http_status}</span>}
                                {d.error && <span className="text-rose-500 truncate max-w-[16rem]" title={d.error}>{d.error}</span>}
                                <span className="ml-auto text-slate-400">{new Date(d.delivered_at).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

/** Compact target creator. Writes are admin-only (RLS), so failures surface plainly. */
const AddTargetForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const [name, setName] = useState('');
    const [system, setSystem] = useState<WritebackTarget['system']>('generic');
    const [url, setUrl] = useState('');
    const [secretEnv, setSecretEnv] = useState('');
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const save = async () => {
        setSaving(true); setErr(null);
        try {
            await writebackService.createTarget({
                name: name.trim(),
                system,
                endpoint_url: url.trim(),
                config: secretEnv.trim() ? { auth: { secret_env: secretEnv.trim(), scheme: 'bearer' } } : {},
            });
            onDone();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-slate-600">Name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plant Maximo"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700" />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-slate-600">System</span>
                    <select value={system} onChange={(e) => setSystem(e.target.value as WritebackTarget['system'])}
                        className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700">
                        {SYSTEMS.map((s) => <option key={s} value={s}>{TARGET_LABELS[s]}</option>)}
                        <option value="other">Other</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                    <span className="font-medium text-slate-600">Endpoint URL</span>
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cmms.example.com/api/workorders"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700 font-mono" />
                </label>
                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                    <span className="font-medium text-slate-600">Auth secret name (optional)</span>
                    <input value={secretEnv} onChange={(e) => setSecretEnv(e.target.value)} placeholder="CUSTOMER_CMMS_TOKEN"
                        className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700 font-mono" />
                    <span className="text-[10px] text-slate-500">
                        The NAME of a Supabase function secret — the token itself is never stored in the database.
                        Set it with <span className="font-mono">supabase secrets set {secretEnv || 'YOUR_TOKEN_NAME'}=…</span>
                    </span>
                </label>
            </div>
            {err && <p className="text-xs text-rose-600 flex items-start gap-1.5"><X size={12} className="mt-0.5" />{err}</p>}
            <div className="flex gap-2">
                <button onClick={() => void save()} disabled={saving || !name.trim() || !url.trim()}
                    className="rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2 disabled:opacity-40 transition-colors">
                    {saving ? 'Saving…' : 'Save target'}
                </button>
                <button onClick={onDone} className="text-xs text-slate-500 hover:text-slate-700 px-3">Cancel</button>
            </div>
        </div>
    );
};

export default DeliverWorkPage;
