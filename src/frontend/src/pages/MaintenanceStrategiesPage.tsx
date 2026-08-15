/**
 * MaintenanceStrategiesPage (R-5) — SAP-style strategy plans with cycle
 * absorption. Define a strategy's nested packages (1M/3M/6M/12M …); the preview
 * shows how the longer cycle absorbs the shorter ones when they coincide, so
 * you run one service instead of stacking jobs — the fix for PM over/under-
 * maintenance.
 *
 * Works as a live planner even before migration 0175 (preview is pure client
 * math); persistence (save/list) lights up once the tables exist.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Trash2, Save, Loader2, Info, Sparkles } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import {
    generateSchedule, absorptionSavings, defaultPackagesForCriticality,
    type MaintenanceStrategy, type StrategyPackage,
} from '../lib/maintenanceStrategy';

let localId = 0;
const nid = () => `p-${Date.now()}-${localId++}`;

const DEFAULT_DRAFT: MaintenanceStrategy = {
    id: '', name: 'New strategy',
    packages: defaultPackagesForCriticality('A').map(p => ({ id: nid(), ...p })),
};

export const MaintenanceStrategiesPage: React.FC = () => {
    const { showToast } = useToast();
    const [ready, setReady] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [strategies, setStrategies] = useState<MaintenanceStrategy[]>([]);
    const [draft, setDraft] = useState<MaintenanceStrategy>(DEFAULT_DRAFT);
    // 0292: apply-to-asset — creates one linked PM per package, idempotently.
    const [assets, setAssets] = useState<any[]>([]);
    const [applyAssetId, setApplyAssetId] = useState('');
    const [applying, setApplying] = useState(false);
    useEffect(() => {
        DatabaseService.getInstance().getAssets().then(a => setAssets(a || [])).catch(() => {});
    }, []);
    const applyToAsset = async () => {
        if (!draft.id || !applyAssetId) return;
        setApplying(true);
        try {
            const { created, skipped } = await DatabaseService.getInstance().applyStrategyToAsset(draft.id, applyAssetId);
            const tag = assets.find((a: any) => a.id === applyAssetId)?.tag || 'asset';
            showToast(
                created.length
                    ? `Created ${created.length} PM${created.length === 1 ? '' : 's'} on ${tag} (${created.join(', ')})${skipped.length ? ` — ${skipped.join(', ')} already existed` : ''}. Coincident cycles will be absorbed at generation.`
                    : `All packages already applied to ${tag} — nothing duplicated.`,
                'success'
            );
        } catch (e: any) {
            showToast('Apply failed: ' + (e?.message || 'unknown'), 'error');
        }
        setApplying(false);
    };

    const load = async () => {
        const db = DatabaseService.getInstance();
        const [isReady, list] = await Promise.all([db.strategiesReady(), db.getStrategies()]);
        setReady(isReady);
        setStrategies(list);
        if (list.length) setDraft(list[0]);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const setPkg = (id: string, patch: Partial<StrategyPackage>) =>
        setDraft(d => ({ ...d, packages: d.packages.map(p => p.id === id ? { ...p, ...patch } : p) }));
    const addPkg = () => setDraft(d => ({ ...d, packages: [...d.packages, { id: nid(), label: '', intervalDays: 30 }] }));
    const removePkg = (id: string) => setDraft(d => ({ ...d, packages: d.packages.filter(p => p.id !== id) }));
    const suggest = (crit: string) => setDraft(d => ({ ...d, packages: defaultPackagesForCriticality(crit).map(p => ({ id: nid(), ...p })) }));
    const newStrategy = () => setDraft({ ...DEFAULT_DRAFT, id: '', packages: DEFAULT_DRAFT.packages.map(p => ({ ...p, id: nid() })) });

    const save = async () => {
        if (!draft.name.trim()) { showToast('Name the strategy.', 'warning'); return; }
        if (draft.packages.some(p => !p.label.trim() || !(p.intervalDays > 0))) { showToast('Every package needs a label and a positive interval.', 'warning'); return; }
        setSaving(true);
        try {
            const id = await DatabaseService.getInstance().saveStrategy({ id: draft.id || undefined, name: draft.name, packages: draft.packages });
            showToast('Strategy saved.', 'success');
            await load();
            setDraft(d => ({ ...d, id }));
        } catch (e: any) { showToast('Save failed: ' + (e?.message || 'unknown'), 'error'); }
        finally { setSaving(false); }
    };
    const remove = async () => {
        if (!draft.id || !confirm(`Delete strategy "${draft.name}"?`)) return;
        try { await DatabaseService.getInstance().deleteStrategy(draft.id); showToast('Strategy deleted.', 'success'); newStrategy(); await load(); }
        catch (e: any) { showToast('Delete failed: ' + (e?.message || 'unknown'), 'error'); }
    };

    // ── Absorption preview (pure client math — always available) ──
    const today = new Date().toISOString().slice(0, 10);
    const schedule = useMemo(() => generateSchedule(draft, today, 360), [draft, today]);
    const savings = useMemo(() => absorptionSavings(schedule), [schedule]);

    if (loading) return <div className="flex justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2"><CalendarClock size={20} className="text-primary-600" /> Maintenance Strategies</h1>
                    <p className="text-xs text-slate-500">Nested cycle packages. The longer cycle absorbs coincident shorter ones — one service, not a stack.</p>
                </div>
                {ready && (
                    <div className="flex items-center gap-2">
                        {strategies.length > 0 && (
                            <select value={draft.id} onChange={e => { const s = strategies.find(x => x.id === e.target.value); if (s) setDraft(s); else newStrategy(); }} className="text-sm border border-slate-300 rounded-lg p-1.5 max-w-[200px]">
                                <option value="">— New strategy —</option>
                                {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        )}
                        <button onClick={newStrategy} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"><Plus size={14} /> New</button>
                    </div>
                )}
            </div>

            {!ready && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <Info size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-900">Saving strategies needs migration <code className="font-mono bg-amber-100 px-1 rounded">0175_maintenance_strategies.sql</code>. You can still design and preview absorption below — it's live client-side math.</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Editor */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Strategy name (e.g. Centrifugal Pump — A)" className="w-full text-sm font-semibold border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-primary-200" />
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-slate-400 flex items-center gap-1"><Sparkles size={11} /> Suggest by criticality:</span>
                        {['A', 'B', 'C', 'D'].map(c => <button key={c} onClick={() => suggest(c)} className="text-[11px] font-bold px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">{c}</button>)}
                    </div>
                    <div className="space-y-2">
                        {draft.packages.map(p => (
                            <div key={p.id} className="flex items-center gap-2">
                                <input value={p.label} onChange={e => setPkg(p.id, { label: e.target.value })} placeholder="Label" className="w-24 text-sm border border-slate-200 rounded-md p-1.5" />
                                <input type="number" min={1} value={p.intervalDays} onChange={e => setPkg(p.id, { intervalDays: Number(e.target.value) })} className="w-24 text-sm text-right border border-slate-200 rounded-md p-1.5" />
                                <span className="text-xs text-slate-400">days</span>
                                <button onClick={() => removePkg(p.id)} className="ml-auto text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                            </div>
                        ))}
                        <button onClick={addPkg} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-500"><Plus size={13} /> Add package</button>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                        <button onClick={save} disabled={saving || !ready} title={!ready ? 'Apply migration 0175 to save' : ''} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                        </button>
                        {ready && draft.id && <button onClick={remove} className="text-sm font-semibold text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg">Delete</button>}
                    </div>

                    {/* Apply to asset (0292): one PM per package, linked for absorption */}
                    {ready && draft.id && (
                        <div className="pt-2 border-t border-slate-100">
                            <p className="text-[11px] font-bold text-slate-500 uppercase mb-1.5">Apply to asset</p>
                            <div className="flex items-center gap-2">
                                <select
                                    value={applyAssetId}
                                    onChange={e => setApplyAssetId(e.target.value)}
                                    className="flex-1 text-sm border border-slate-200 rounded-lg p-2 bg-white min-w-0"
                                >
                                    <option value="">Select asset…</option>
                                    {assets.map((a: any) => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                                <button
                                    onClick={applyToAsset}
                                    disabled={!applyAssetId || applying}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                                >
                                    {applying ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create PM set
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                                Creates one recurring PM per package on the asset, linked to this strategy. Re-running skips packages that already exist.
                            </p>
                        </div>
                    )}
                </div>

                {/* Absorption preview */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-700">12-month schedule</h3>
                        <span className="text-[11px] text-slate-500">
                            <strong className="text-emerald-600">{savings.actualVisits}</strong> visits vs <span className="line-through text-slate-400">{savings.naiveVisits}</span> · <strong>{savings.absorbedVisits}</strong> absorbed
                        </span>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                        {schedule.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Add packages to preview the schedule.</p>}
                        {schedule.map(s => (
                            <div key={s.offsetDays} className="flex items-center gap-3 py-2">
                                <span className="text-xs font-mono text-slate-400 w-16">{s.date.slice(5)}</span>
                                <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                                    {s.executed.map(p => <span key={p.id} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary-600 text-white">{p.label}</span>)}
                                    {s.absorbed.map(p => <span key={p.id} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 line-through">{p.label}</span>)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">Struck-through packages are absorbed into the longer service due the same day (their scope is included). Day offsets from today over a 360-day horizon.</p>
                </div>
            </div>
        </div>
    );
};
