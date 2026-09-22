/**
 * IntegrationsPage — Admin › Integrations
 *
 * The live link's operating screen (docs/SAP-Live-Link-Plan.md §2.6): the
 * systems this tenant is connected to, what flows which way and who wins,
 * Test connection / Dry-run / Sync now, the run history, and — the product —
 * the exception queue: every document that needs a person, with Retry, Skip
 * and Open record. Nothing here sends anything itself; every action goes
 * through the erp-sync worker with the person's own login, and the worker
 * decides whether they may run it.
 *
 * Phase 1 carries master data (functional locations and equipment). The
 * other families are shown so the ownership rule is written down per tenant
 * before they flow, and marked with the phase that switches them on.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plug, Plus, RefreshCw, Loader2, FlaskConical, Play, Pencil, Trash2, AlertTriangle, CheckCircle2,
    RotateCcw, SkipForward, ExternalLink, Info, ArrowLeftRight, ArrowRight, ArrowLeft, Database, Wand2,
} from 'lucide-react';
import { useToast } from '../../eam/contexts/ToastContext';
import { useConfirm } from '../../eam/contexts/ConfirmContext';
import { useAuth } from '../../eam/contexts/AuthContext';
import {
    erpLinkService, isMissingTable,
    type ErpTarget, type TargetDraft, type OutboxRow, type ErpRun, type SimEntity, type SyncReport, type AuthMode, type TargetSystem,
} from '../../eam/services/erpLinkService';
import { DEFAULT_FAMILIES, FAMILIES, FAMILY_LABELS, FAMILY_PHASE, type Family, type FamilyRule } from '../../lib/erpLink/masterData';

const SYSTEM_LABEL: Record<TargetSystem, string> = { sap_s4: 'SAP S/4HANA', sap_sim: 'SAP simulator', generic: 'Other ERP' };
const AUTH_LABEL: Record<AuthMode, string> = { none: 'No authentication', basic: 'Username and password', bearer: 'Bearer token', oauth2_client_credentials: 'OAuth2 client credentials' };
const DIRECTION_LABEL: Record<FamilyRule['direction'], string> = { both: 'Both ways', out: 'IREAMS → SAP only', in: 'SAP → IREAMS only', off: 'Off' };

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const ago = (iso: string | null | undefined) => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
};

const STATUS_CHIP: Record<string, string> = {
    sent: 'bg-green-50 text-green-700 border-green-200',
    done: 'bg-green-50 text-green-700 border-green-200',
    pending: 'bg-slate-100 text-slate-600 border-slate-200',
    running: 'bg-primary-50 text-primary-700 border-primary-200',
    dry_run: 'bg-primary-50 text-primary-700 border-primary-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    conflict: 'bg-amber-50 text-amber-800 border-amber-200',
    skipped: 'bg-slate-100 text-slate-500 border-slate-200',
    busy: 'bg-amber-50 text-amber-800 border-amber-200',
};
const STATUS_WORD: Record<string, string> = {
    sent: 'Done', done: 'Done', pending: 'Waiting', running: 'Running', dry_run: 'Dry run',
    failed: 'Failed', conflict: 'Conflict', skipped: 'Skipped', busy: 'Busy',
};
const Chip: React.FC<{ status: string }> = ({ status }) => (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        {STATUS_WORD[status] ?? status}
    </span>
);

const DOC_WORD: Record<string, string> = {
    equipment: 'Equipment', functional_location: 'Functional location',
    measuring_point: 'Measuring point', measurement_document: 'Reading',
};
const docWord = (t: string) => DOC_WORD[t] ?? t.replace(/_/g, ' ');

/** Where "Open record" goes for each document kind. A reading opens its point's trend. */
const recordHref = (row: OutboxRow): string => {
    switch (row.document_type) {
        case 'measuring_point': return `/readings?point=${encodeURIComponent(row.document_id)}`;
        case 'measurement_document': return '/readings';
        default: return `/assets?id=${encodeURIComponent(row.document_id)}`;
    }
};

/** "3 sent · 1 failed" — the numbers a person wants from a run, in words. */
const STAT_WORDS: [string, string][] = [
    ['out_sent', 'sent to SAP'], ['out_dry_run', 'would be sent'], ['out_failed', 'failed'], ['out_conflict', 'conflicts'],
    ['out_already_sent', 'already sent'], ['out_waiting', 'waiting for retry'], ['out_retried', 'retried'], ['out_resend_queued', 'queued to re-send'],
    ['in_applied', 'updated from SAP'], ['in_created', 'created from SAP'], ['in_adopted', 'linked by tag'], ['in_conflict', 'conflicts'],
    ['in_dry_run', 'would change'], ['in_echo', 'echoes ignored'], ['in_unchanged', 'unchanged'], ['out_in_sync', 'already in step'],
    ['out_object_unlinked', 'points held (object not in SAP yet)'], ['out_point_unlinked', 'readings held (point not in SAP yet)'],
    ['out_reading_not_logged', 'machine readings kept back'], ['in_object_unknown', 'SAP points on unknown objects'],
    ['in_point_unknown', 'SAP readings on unknown points'], ['in_no_value', 'SAP documents without a value'],
    ['equipment_seen', 'equipment visible'], ['deleted', 'removed'],
];
const statsText = (s: Record<string, number> | null | undefined): string => {
    if (!s) return '';
    const parts = STAT_WORDS.filter(([k]) => (s[k] ?? 0) > 0).map(([k, w]) => `${s[k]} ${w}`);
    return parts.length ? parts.join(' · ') : 'nothing to do';
};

const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50';
const btnQuiet = `${btn} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const btnPrimary = `${btn} border-primary-600 bg-primary-600 text-white hover:bg-primary-700`;
const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200';
const label = 'block text-xs font-semibold text-slate-600 mb-1';

const emptyDraft = (): TargetDraft => ({
    name: '', system: 'sap_s4', base_url: '', auth: { mode: 'oauth2_client_credentials', secret_name: '' },
    families: { ...DEFAULT_FAMILIES }, poll_interval_minutes: 5, dry_run: true, is_active: false,
});

// ── The target form ──────────────────────────────────────────────────────────

const TargetForm: React.FC<{ initial: TargetDraft; companyId: string | null; onClose: () => void; onSaved: (t: ErpTarget) => void }> = ({ initial, companyId, onClose, onSaved }) => {
    const { showToast } = useToast();
    const [d, setD] = useState<TargetDraft>(initial);
    const [saving, setSaving] = useState(false);
    const set = <K extends keyof TargetDraft>(k: K, v: TargetDraft[K]) => setD((p) => ({ ...p, [k]: v }));
    const setAuth = (patch: Partial<TargetDraft['auth']>) => setD((p) => ({ ...p, auth: { ...p.auth, ...patch } }));
    const setRule = (f: Family, patch: Partial<FamilyRule>) =>
        setD((p) => ({ ...p, families: { ...p.families, [f]: { ...(p.families[f] ?? DEFAULT_FAMILIES[f]), ...patch } } }));

    const useSimulator = () => {
        if (!companyId) { showToast('Your login has no tenant claim — sign out and in again.', 'error'); return; }
        setD((p) => ({
            ...p, name: p.name || 'SAP simulator', system: 'sap_sim',
            base_url: erpLinkService.simulatorBaseUrl(companyId),
            auth: { mode: 'bearer', secret_name: 'SAP_SIM_TOKEN' },
        }));
    };

    const save = async () => {
        if (!d.name.trim()) { showToast('Give the system a name.', 'error'); return; }
        if (!/^https?:\/\//.test(d.base_url.trim())) { showToast('The base URL must start with http:// or https://', 'error'); return; }
        if (d.auth.mode !== 'none' && !d.auth.secret_name?.trim()) { showToast('Name the secret that holds the credential.', 'error'); return; }
        if (d.auth.mode === 'oauth2_client_credentials' && (!d.auth.token_url || !d.auth.client_id)) { showToast('OAuth2 needs a token URL and a client id.', 'error'); return; }
        setSaving(true);
        try {
            const saved = await erpLinkService.saveTarget(d);
            onSaved(saved);
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'Could not save.', 'error');
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end md:items-center justify-center p-0 md:p-6" onClick={onClose}>
            <div className="w-full md:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                    <h2 className="font-bold text-slate-800">{d.id ? 'Edit system' : 'Connect a system'}</h2>
                    <button type="button" className={btnQuiet} onClick={useSimulator}><Wand2 size={13} /> Use the simulator</button>
                </div>
                <div className="p-5 space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div><label className={label}>Name</label><input className={input} value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Production S/4HANA" /></div>
                        <div><label className={label}>System</label>
                            <select className={input} value={d.system} onChange={(e) => set('system', e.target.value as TargetSystem)}>
                                {(Object.keys(SYSTEM_LABEL) as TargetSystem[]).map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
                            </select>
                        </div>
                        <div className="md:col-span-2"><label className={label}>OData service root (base URL)</label>
                            <input className={`${input} font-mono text-xs`} value={d.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="https://my-s4.example.com/sap/opu/odata4/sap/api_equipment/srvd_a2x/sap/equipment/0001" />
                            <p className="text-[11px] text-slate-500 mt-1">The link appends <code>/A_Equipment</code>, <code>/A_FunctionalLocation</code>… to this. Through SAP CPI, point it at the iFlow's endpoint instead.</p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                        <div className="text-sm font-semibold text-slate-800">Credentials</div>
                        <p className="text-xs text-slate-500">IREAMS never stores a password or token. Name the project secret that holds it; an administrator sets the value with <code>supabase secrets set NAME=…</code>.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div><label className={label}>Method</label>
                                <select className={input} value={d.auth.mode} onChange={(e) => setAuth({ mode: e.target.value as AuthMode })}>
                                    {(Object.keys(AUTH_LABEL) as AuthMode[]).map((m) => <option key={m} value={m}>{AUTH_LABEL[m]}</option>)}
                                </select>
                            </div>
                            {d.auth.mode !== 'none' && (
                                <div><label className={label}>Secret name</label><input className={`${input} font-mono text-xs`} value={d.auth.secret_name ?? ''} onChange={(e) => setAuth({ secret_name: e.target.value.trim() })} placeholder="SAP_PROD_CLIENT_SECRET" /></div>
                            )}
                            {d.auth.mode === 'basic' && (
                                <div><label className={label}>Username</label><input className={input} value={d.auth.username ?? ''} onChange={(e) => setAuth({ username: e.target.value })} /></div>
                            )}
                            {d.auth.mode === 'oauth2_client_credentials' && (<>
                                <div><label className={label}>Token URL</label><input className={`${input} font-mono text-xs`} value={d.auth.token_url ?? ''} onChange={(e) => setAuth({ token_url: e.target.value.trim() })} placeholder="https://…/oauth/token" /></div>
                                <div><label className={label}>Client id</label><input className={input} value={d.auth.client_id ?? ''} onChange={(e) => setAuth({ client_id: e.target.value.trim() })} /></div>
                            </>)}
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-4">
                        <div className="text-sm font-semibold text-slate-800">What flows, and who wins</div>
                        <p className="text-xs text-slate-500 mt-1 mb-3">When both sides change the same record, the owner's version stands and the other side's change is queued for a person to see. SAP normally owns master data and orders; IREAMS owns readings, reliability results and interval proposals.</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="py-1 pr-3 font-semibold">Family</th><th className="py-1 pr-3 font-semibold">Direction</th><th className="py-1 pr-3 font-semibold">Owner</th><th className="py-1 font-semibold">Status</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {FAMILIES.map((f) => {
                                        const rule = d.families[f] ?? DEFAULT_FAMILIES[f];
                                        const live = FAMILY_PHASE[f] === 1;
                                        return (
                                            <tr key={f}>
                                                <td className="py-2 pr-3 text-slate-700">{FAMILY_LABELS[f]}</td>
                                                <td className="py-2 pr-3">
                                                    <select className="rounded-lg border border-slate-300 px-2 py-1 text-xs" value={rule.direction} onChange={(e) => setRule(f, { direction: e.target.value as FamilyRule['direction'] })}>
                                                        {(Object.keys(DIRECTION_LABEL) as FamilyRule['direction'][]).map((k) => <option key={k} value={k}>{DIRECTION_LABEL[k]}</option>)}
                                                    </select>
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <select className="rounded-lg border border-slate-300 px-2 py-1 text-xs" value={rule.owner} onChange={(e) => setRule(f, { owner: e.target.value as FamilyRule['owner'] })}>
                                                        <option value="sap">SAP wins</option><option value="ireams">IREAMS wins</option>
                                                    </select>
                                                </td>
                                                <td className="py-2 text-xs">{live ? <span className="text-green-700 font-semibold">Live</span> : <span className="text-slate-400">Phase {FAMILY_PHASE[f]} — rule saved, not flowing yet</span>}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                        <div><label className={label}>Check every (minutes)</label><input type="number" min={1} className={input} value={d.poll_interval_minutes} onChange={(e) => set('poll_interval_minutes', Math.max(1, Number(e.target.value) || 1))} /></div>
                        <label className="flex items-center gap-2 text-sm text-slate-700 py-2"><input type="checkbox" checked={d.dry_run} onChange={(e) => set('dry_run', e.target.checked)} /> Dry run — record what would be sent, send nothing</label>
                        <label className="flex items-center gap-2 text-sm text-slate-700 py-2"><input type="checkbox" checked={d.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Run on the clock</label>
                    </div>
                </div>
                <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
                    <button type="button" className={btnQuiet} onClick={onClose}>Cancel</button>
                    <button type="button" className={btnPrimary} onClick={save} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save</button>
                </div>
            </div>
        </div>
    );
};

// ── The page ─────────────────────────────────────────────────────────────────

export const IntegrationsPage: React.FC = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const { user } = useAuth();
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [targets, setTargets] = useState<ErpTarget[]>([]);
    const [queue, setQueue] = useState<OutboxRow[]>([]);
    const [runs, setRuns] = useState<ErpRun[]>([]);
    const [docs, setDocs] = useState<OutboxRow[]>([]);
    const [sim, setSim] = useState<SimEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [editing, setEditing] = useState<TargetDraft | null>(null);
    const [simEdit, setSimEdit] = useState({ set: 'A_Equipment', key: '', name: '' });

    const targetName = useMemo(() => Object.fromEntries(targets.map((t) => [t.id, t.name])), [targets]);
    const simTarget = useMemo(() => targets.find((t) => t.system === 'sap_sim') ?? null, [targets]);

    const load = useCallback(async () => {
        try {
            const [cid, ts, q, rs, ds] = await Promise.all([
                erpLinkService.companyId(), erpLinkService.listTargets(), erpLinkService.listQueue(), erpLinkService.listRuns(), erpLinkService.listRecentDocuments(),
            ]);
            setCompanyId(cid); setTargets(ts); setQueue(q); setRuns(rs); setDocs(ds); setMissing(false);
            if (ts.some((t) => t.system === 'sap_sim')) {
                try { setSim(await erpLinkService.listSimulator()); } catch { setSim([]); }
            }
        } catch (e) {
            const err = e as { code?: string; message?: string };
            if (isMissingTable(err)) setMissing(true);
            else showToast(err.message ?? 'Could not load.', 'error');
        } finally { setLoading(false); }
    }, [showToast]);

    useEffect(() => { void load(); }, [load]);

    const report = (rs: SyncReport[], verb: string) => {
        for (const r of rs) {
            if (r.status === 'failed') showToast(`${r.name}: ${r.error ?? 'failed'}`, 'error', 6000);
            else if (r.status === 'busy') showToast(`${r.name}: another run is in progress.`, 'info');
            else showToast(`${r.name}: ${verb} — ${statsText(r.stats)}${r.dry_run && verb !== 'connection ok' ? ' (dry run)' : ''}`, 'success', 6000);
        }
    };

    const runFor = async (t: ErpTarget | null, mode: 'test' | 'dry_run' | 'sync') => {
        const key = `${t?.id ?? 'all'}:${mode}`;
        setBusy(key);
        try {
            const rs = await erpLinkService.run(mode, t?.id);
            report(rs, mode === 'test' ? 'connection ok' : mode === 'dry_run' ? 'dry run' : 'synced');
            await load();
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'The worker did not answer.', 'error', 6000);
        } finally { setBusy(null); }
    };

    const remove = async (t: ErpTarget) => {
        if (!(await confirm({ title: `Remove ${t.name}?`, message: 'Its run history and document trail are removed with it. The mappings between IREAMS records and SAP numbers stay.', confirmLabel: 'Remove', variant: 'danger' }))) return;
        try { await erpLinkService.deleteTarget(t.id); showToast('Removed.', 'success'); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : 'Could not remove.', 'error'); }
    };

    const retry = async (row: OutboxRow) => {
        if (row.status === 'conflict' && !(await confirm({ title: 'Send IREAMS\'s version over SAP\'s?', message: 'SAP changed this record too. Retry overwrites SAP\'s version with what IREAMS has.', confirmLabel: 'Send IREAMS\'s version' }))) return;
        try { await erpLinkService.retry(row, user?.id ?? null); showToast('Queued for the next run.', 'success'); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : 'Could not retry.', 'error'); }
    };
    const skip = async (row: OutboxRow) => {
        if (!(await confirm({ title: 'Skip this document?', message: 'It leaves the queue and is not sent. The record stays as it is on both sides.', confirmLabel: 'Skip' }))) return;
        try { await erpLinkService.skip(row, user?.id ?? null, ''); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : 'Could not skip.', 'error'); }
    };
    const acknowledge = async (row: OutboxRow) => {
        try { await erpLinkService.acknowledge(row, user?.id ?? null); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : 'Could not acknowledge.', 'error'); }
    };

    const simIsDocument = simEdit.set === 'A_MeasurementDocument';
    const simChange = async () => {
        if (!simTarget) return;
        if (!simEdit.key.trim() || !simEdit.name.trim()) { showToast(simIsDocument ? 'Give the measuring point number and the value.' : 'Give the SAP key and the new name.', 'error'); return; }
        setBusy('sim_edit');
        try {
            let edit: { set: string; key?: string; changes: Record<string, unknown> };
            if (simIsDocument) {
                // A planner logging a reading in SAP: a new document on the point, dated now.
                const value = Number(simEdit.name.trim());
                if (!Number.isFinite(value)) { showToast('The value must be a number.', 'error'); return; }
                const now = new Date();
                edit = { set: simEdit.set, changes: { MeasuringPoint: simEdit.key.trim(), MsmtRdngDate: now.toISOString().slice(0, 10), MsmtRdngTime: now.toISOString().slice(11, 19), MeasurementReadingInEntryUoM: value, MeasurementReadingByUser: 'PLANNER' } };
            } else {
                const field = simEdit.set === 'A_Equipment' ? 'EquipmentName' : simEdit.set === 'A_MeasuringPoint' ? 'MeasuringPointDescription' : 'FunctionalLocationName';
                edit = { set: simEdit.set, key: simEdit.key.trim(), changes: { [field]: simEdit.name.trim() } };
            }
            const rs = await erpLinkService.run('sim_edit', simTarget.id, { edit });
            if (rs[0]?.error) showToast(rs[0].error, 'error', 6000); else showToast(simIsDocument ? 'Logged in the simulator. Sync now to see it arrive as a reading.' : 'Changed in the simulator. Sync now to see it come back.', 'success');
            setSimEdit((s) => ({ ...s, name: '' }));
            await load();
        } catch (e) { showToast(e instanceof Error ? e.message : 'Could not change.', 'error'); }
        finally { setBusy(null); }
    };
    const simReset = async () => {
        if (!simTarget) return;
        if (!(await confirm({ title: 'Empty the simulator?', message: 'Every object "in SAP" is removed. IREAMS records and their mappings stay; the next sync creates the objects again.', confirmLabel: 'Empty it', variant: 'danger' }))) return;
        setBusy('sim_reset');
        try { const rs = await erpLinkService.run('sim_reset', simTarget.id); if (rs[0]?.error) showToast(rs[0].error, 'error'); else showToast(`Removed ${rs[0]?.stats.deleted ?? 0} objects.`, 'success'); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : 'Could not reset.', 'error'); }
        finally { setBusy(null); }
    };

    const openRecord = (row: OutboxRow) => navigate(recordHref(row));

    const familiesLine = (t: ErpTarget) => FAMILIES
        .filter((f) => (t.families[f]?.direction ?? 'off') !== 'off')
        .map((f) => {
            const r = t.families[f]!;
            const arrow = r.direction === 'both' ? <ArrowLeftRight size={11} /> : r.direction === 'out' ? <ArrowRight size={11} /> : <ArrowLeft size={11} />;
            return <span key={f} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{arrow}{FAMILY_LABELS[f].split(' — ')[0]} · {r.owner === 'sap' ? 'SAP wins' : 'IREAMS wins'}{FAMILY_PHASE[f] > 1 ? ` · phase ${FAMILY_PHASE[f]}` : ''}</span>;
        });

    return (
        <div className="ers-page-form space-y-6 pb-24 animate-in fade-in duration-300">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2"><Plug size={22} className="text-primary-600" /> Integrations</h1>
                    <p className="text-slate-500 text-sm mt-1 max-w-2xl">Connected systems, what flows which way, and what needs a person. Every document sent or received is kept verbatim.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" className={btnQuiet} onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
                    <button type="button" className={btnPrimary} onClick={() => setEditing(emptyDraft())} disabled={missing}><Plus size={13} /> Connect a system</button>
                </div>
            </div>

            {missing && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <div>The live link's tables are not on this database yet (migration 0383). Apply it, then reload this page.</div>
                </div>
            )}

            {!missing && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                        ['1 · Connect', 'Point at the OData service root and name the secret that holds the credential. Test connection reads one equipment and reports.'],
                        ['2 · Dry-run', 'Every target starts in dry run: the documents SAP would receive are recorded, nothing is sent. Read them in Recent documents.'],
                        ['3 · Switch on', 'Turn off dry run and put the target on the clock. From then on, what changed on either side flows every few minutes; what needs a person waits below.'],
                    ].map(([h, p]) => (
                        <div key={h} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="text-sm font-bold text-slate-800 mb-1">{h}</div>
                            <p className="text-xs text-slate-500 leading-relaxed">{p}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Targets ── */}
            {!missing && (
                <section className="space-y-3">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Database size={16} className="text-primary-600" /> Connected systems</h2>
                    {loading && targets.length === 0 && <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
                    {!loading && targets.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
                            Nothing is connected yet. <button type="button" className="text-primary-700 font-semibold hover:underline" onClick={() => setEditing(emptyDraft())}>Connect a system</button> — or start with the simulator to see the loop run end to end before any SAP is involved.
                        </div>
                    )}
                    {targets.map((t) => (
                        <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-slate-800">{t.name}</span>
                                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{SYSTEM_LABEL[t.system]}</span>
                                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${t.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{t.is_active ? 'On the clock' : 'Paused'}</span>
                                        {t.dry_run && <span className="rounded-md bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700">Dry run</span>}
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-500 mt-1 truncate max-w-xl">{t.base_url}</div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">{familiesLine(t)}</div>
                                    <div className="text-xs text-slate-500 mt-2">
                                        Last run {ago(t.last_run_at)}{t.last_status ? ` · ${t.last_status}` : ''}{t.last_error ? <span className="text-rose-700"> · {t.last_error}</span> : ''}
                                        {' · '}checks every {t.poll_interval_minutes} min · {AUTH_LABEL[t.auth?.mode ?? 'none']}{t.auth?.secret_name ? <> via <code className="text-[11px]">{t.auth.secret_name}</code></> : ''}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    <button type="button" className={btnQuiet} onClick={() => void runFor(t, 'test')} disabled={!!busy}>{busy === `${t.id}:test` ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Test connection</button>
                                    <button type="button" className={btnQuiet} onClick={() => void runFor(t, 'dry_run')} disabled={!!busy}>{busy === `${t.id}:dry_run` ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Dry-run</button>
                                    <button type="button" className={btnPrimary} onClick={() => void runFor(t, 'sync')} disabled={!!busy} title={t.dry_run ? 'The target is in dry run: this records, it does not send.' : 'Send and receive now'}>{busy === `${t.id}:sync` ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Sync now</button>
                                    <button type="button" className={btnQuiet} onClick={() => setEditing({ id: t.id, name: t.name, system: t.system, base_url: t.base_url, auth: t.auth, families: { ...DEFAULT_FAMILIES, ...t.families }, poll_interval_minutes: t.poll_interval_minutes, dry_run: t.dry_run, is_active: t.is_active })}><Pencil size={13} /> Edit</button>
                                    <button type="button" className={`${btnQuiet} text-rose-700`} onClick={() => void remove(t)}><Trash2 size={13} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {/* ── Exception queue ── */}
            {!missing && (
                <section className="space-y-3">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><AlertTriangle size={16} className="text-amber-600" /> Needs a person <span className="text-slate-400 font-normal text-sm">· {queue.length}</span></h2>
                    {queue.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 flex items-center gap-2"><CheckCircle2 size={15} className="text-green-600" /> Nothing is waiting. Failed sends and conflicts appear here with the reason and what to do.</div>
                    ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
                            {queue.map((row) => (
                                <div key={row.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Chip status={row.status} />
                                            <span className="font-semibold text-slate-800">{row.document_key ?? row.document_id.slice(0, 8)}</span>
                                            <span className="text-xs text-slate-500">{docWord(row.document_type)} · {row.direction === 'OUT' ? 'IREAMS → SAP' : 'SAP → IREAMS'} · {targetName[row.target_id] ?? 'target'}</span>
                                        </div>
                                        <div className="text-sm text-slate-700 mt-1">{row.reason ?? row.error ?? '—'}</div>
                                        {row.reason && row.error && <div className="text-xs text-slate-500 mt-0.5 font-mono break-all">{row.error}</div>}
                                        <div className="text-[11px] text-slate-400 mt-1">{row.attempts} attempt{row.attempts === 1 ? '' : 's'}{row.http_status ? ` · HTTP ${row.http_status}` : ''} · {when(row.updated_at)}{row.next_attempt_at && row.status === 'failed' ? ` · retries ${ago(row.next_attempt_at) === 'just now' ? 'on the next run' : when(row.next_attempt_at)}` : ''}</div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {row.direction === 'OUT' && <button type="button" className={btnQuiet} onClick={() => void retry(row)}><RotateCcw size={13} /> Retry</button>}
                                        {row.direction === 'IN' && row.status === 'conflict' && <button type="button" className={btnQuiet} onClick={() => void acknowledge(row)}><CheckCircle2 size={13} /> Acknowledge</button>}
                                        <button type="button" className={btnQuiet} onClick={() => void skip(row)}><SkipForward size={13} /> Skip</button>
                                        <button type="button" className={btnQuiet} onClick={() => openRecord(row)}><ExternalLink size={13} /> Open record</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* ── Simulator ── */}
            {!missing && simTarget && (
                <section className="rounded-2xl border border-primary-200 bg-primary-50/40 p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Wand2 size={16} className="text-primary-600" /> In the simulator — what "SAP" has</h2>
                            <p className="text-xs text-slate-600 mt-1">Change something here as if a planner did it in SAP, then Sync now and watch it come back — or watch the owner win when both sides changed it.</p>
                        </div>
                        <button type="button" className={`${btnQuiet} text-rose-700`} onClick={() => void simReset()} disabled={!!busy}><Trash2 size={13} /> Empty the simulator</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr_auto] gap-2 items-end">
                        <div><label className={label}>Object</label>
                            <select className={input} value={simEdit.set} onChange={(e) => setSimEdit((s) => ({ ...s, set: e.target.value, key: '', name: '' }))}>
                                <option value="A_Equipment">Equipment</option><option value="A_FunctionalLocation">Functional location</option>
                                <option value="A_MeasuringPoint">Measuring point</option><option value="A_MeasurementDocument">Reading (new document)</option>
                            </select>
                        </div>
                        <div><label className={label}>{simIsDocument ? 'Measuring point number' : 'SAP key'}</label><input className={`${input} font-mono text-xs`} value={simEdit.key} onChange={(e) => setSimEdit((s) => ({ ...s, key: e.target.value }))} placeholder={simIsDocument ? '1000' : '10000001'} list="sim-keys" />
                            <datalist id="sim-keys">{sim.filter((e) => e.entity_set === (simIsDocument ? 'A_MeasuringPoint' : simEdit.set)).map((e) => <option key={e.id} value={e.entity_key} />)}</datalist>
                        </div>
                        <div><label className={label}>{simIsDocument ? 'Value' : 'New name'}</label><input className={input} value={simEdit.name} onChange={(e) => setSimEdit((s) => ({ ...s, name: e.target.value }))} placeholder={simIsDocument ? '4.2' : 'Renamed in SAP'} /></div>
                        <button type="button" className={btnPrimary} onClick={() => void simChange()} disabled={!!busy}>{busy === 'sim_edit' ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />} {simIsDocument ? 'Log a reading in SAP' : 'Change in SAP'}</button>
                    </div>
                    {sim.length > 0 && (
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="w-full text-xs">
                                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2 font-semibold">Object</th><th className="px-3 py-2 font-semibold">Key</th><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Changed</th><th className="px-3 py-2 font-semibold">ETag</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {sim.map((e) => (
                                        <tr key={e.id}>
                                            <td className="px-3 py-1.5 text-slate-600">{e.entity_set.replace('A_', '').replace(/([a-z])([A-Z])/g, '$1 $2')}</td>
                                            <td className="px-3 py-1.5 font-mono">{e.entity_key}</td>
                                            <td className="px-3 py-1.5 text-slate-800">{String(e.payload.EquipmentName ?? e.payload.FunctionalLocationName ?? e.payload.MeasuringPointDescription ?? (e.payload.MeasurementReadingInEntryUoM !== undefined ? `${e.payload.MeasurementReadingInEntryUoM} on point ${e.payload.MeasuringPoint}` : ''))}</td>
                                            <td className="px-3 py-1.5 text-slate-500">{when(e.last_change_datetime)}</td>
                                            <td className="px-3 py-1.5 font-mono text-slate-400">W/"{e.etag}"</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {sim.length === 0 && <div className="text-xs text-slate-500">The simulator is empty. Sync now with dry run off creates your equipment and functional locations in it.</div>}
                </section>
            )}

            {/* ── Runs ── */}
            {!missing && (
                <section className="space-y-3">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><RefreshCw size={16} className="text-primary-600" /> Recent runs</h2>
                    {runs.length === 0 ? <div className="text-sm text-slate-500">No runs yet.</div> : (
                        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                            <table className="w-full text-xs">
                                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2 font-semibold">Started</th><th className="px-3 py-2 font-semibold">System</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">What happened</th><th className="px-3 py-2 font-semibold">By</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {runs.map((r) => (
                                        <tr key={r.id}>
                                            <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{when(r.started_at)}</td>
                                            <td className="px-3 py-1.5 text-slate-800">{targetName[r.target_id] ?? '—'}</td>
                                            <td className="px-3 py-1.5"><Chip status={r.status} />{r.dry_run && <span className="ml-1 text-[11px] text-primary-700">dry run</span>}</td>
                                            <td className="px-3 py-1.5 text-slate-700">{r.error ? <span className="text-rose-700">{r.error}</span> : statsText(r.stats)}</td>
                                            <td className="px-3 py-1.5 text-slate-500">{r.worker?.startsWith('user:') ? 'a person' : r.worker ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {/* ── Documents ── */}
            {!missing && (
                <section className="space-y-3">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Info size={16} className="text-primary-600" /> Recent documents</h2>
                    {docs.length === 0 ? <div className="text-sm text-slate-500">Nothing has been sent or received yet.</div> : (
                        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                            <table className="w-full text-xs">
                                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2 font-semibold">When</th><th className="px-3 py-2 font-semibold">Record</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Direction</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">SAP number</th><th className="px-3 py-2 font-semibold">Note</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {docs.map((d) => (
                                        <tr key={d.id}>
                                            <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{when(d.created_at)}</td>
                                            <td className="px-3 py-1.5 font-semibold text-slate-800">{d.document_key ?? d.document_id.slice(0, 8)}</td>
                                            <td className="px-3 py-1.5 text-slate-600">{docWord(d.document_type)}</td>
                                            <td className="px-3 py-1.5 text-slate-600">{d.direction === 'OUT' ? 'IREAMS → SAP' : 'SAP → IREAMS'}</td>
                                            <td className="px-3 py-1.5"><Chip status={d.status} /></td>
                                            <td className="px-3 py-1.5 font-mono">{d.external_key ?? '—'}</td>
                                            <td className="px-3 py-1.5 text-slate-500 max-w-md truncate" title={d.reason ?? d.error ?? ''}>{d.reason ?? d.error ?? (d.status === 'dry_run' ? 'Recorded, not sent' : '')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            )}

            {editing && <TargetForm initial={editing} companyId={companyId} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); showToast(`${t.name} saved.`, 'success'); void load(); }} />}
        </div>
    );
};

export default IntegrationsPage;
