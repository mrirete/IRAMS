/**
 * SMEATab — Success Mode & Effects Analysis (PSC framework, Olorunfemi 2026 §4.4).
 *
 * The value-centric flip of FMEA: instead of cataloging the ways an asset can
 * fail, capture the CONDITIONS that keep it at peak and prioritize them by
 * SPN = Value Impact × Sustainability × Monitorability. Monitorability is
 * scored DIRECTLY (10 = continuously monitorable = actively manageable) —
 * deliberately the opposite of FMEA's Detectability. SPN is computed by the
 * database (generated column), never client-side.
 */
import React, { useEffect, useState } from 'react';
import { Star, Plus, Trash2, Loader2, ArrowLeft, Info } from 'lucide-react';
import { analyzeService, type SMEAWorksheet, type SMEAItem } from '../../eam/services/AnalyzeService';
import { useAssetContext } from '../../contexts/AssetContext';

const STATUS_CLS: Record<string, string> = {
    open: 'bg-slate-100 text-slate-600', monitored: 'bg-blue-50 text-blue-700',
    sustained: 'bg-emerald-50 text-emerald-700', dropped: 'bg-slate-50 text-slate-400 line-through',
};
const spnCls = (spn: number) =>
    spn >= 500 ? 'bg-emerald-100 text-emerald-800' : spn >= 250 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';

const Score: React.FC<{ value: number; onChange: (v: number) => void; title: string }> = ({ value, onChange, title }) => (
    <input type="number" min={1} max={10} value={value} title={title}
        onChange={e => onChange(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
        className="w-12 px-1 py-1 text-center text-xs font-bold border border-slate-200 rounded-md" />
);

export const SMEATab: React.FC = () => {
    const { assets } = useAssetContext();
    const [sheets, setSheets] = useState<SMEAWorksheet[]>([]);
    const [selected, setSelected] = useState<SMEAWorksheet | null>(null);
    const [items, setItems] = useState<SMEAItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newAssetId, setNewAssetId] = useState('');
    // draft item row
    const [mode, setMode] = useState(''); const [cond, setCond] = useState(''); const [action, setAction] = useState('');
    const [vi, setVi] = useState(8); const [su, setSu] = useState(7); const [mo, setMo] = useState(8);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        setSheets(await analyzeService.getSMEAWorksheets());
        setLoading(false);
    };
    useEffect(() => { load(); }, []);
    useEffect(() => {
        if (!selected) { setItems([]); return; }
        analyzeService.getSMEAItems(selected.id).then(setItems);
    }, [selected]);

    const createSheet = async () => {
        if (!newTitle.trim()) return;
        setCreating(true);
        const ws = await analyzeService.createSMEAWorksheet({
            asset_id: newAssetId || null, title: newTitle.trim(),
            status: 'draft', description: null, created_by: null,
        });
        setCreating(false);
        if (ws) { setNewTitle(''); setSheets(s => [ws, ...s]); setSelected(ws); }
    };

    const addItem = async () => {
        if (!selected || !mode.trim()) return;
        setSaving(true);
        const it = await analyzeService.createSMEAItem({
            worksheet_id: selected.id, success_mode: mode.trim(),
            success_condition: cond.trim() || null,
            value_impact: vi, sustainability: su, monitorability: mo,
            priority_action: action.trim() || null, status: 'open',
        });
        setSaving(false);
        if (it) {
            setItems(prev => [...prev, it].sort((a, b) => b.spn - a.spn));
            setMode(''); setCond(''); setAction('');
        }
    };

    const assetTag = (id: string | null) => assets.find(a => a.id === id)?.tag || '—';

    if (loading) return <div className="p-6 text-sm text-slate-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading SMEA…</div>;

    // ── Worksheet detail ────────────────────────────────────
    if (selected) {
        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700">
                        <ArrowLeft size={14} /> All SMEA worksheets
                    </button>
                    <span className="text-[10px] text-slate-400 font-medium italic">SPN = Value × Sustainability × Monitorability · monitorability scored directly (10 = continuously monitorable)</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600"><Star size={14} /></span>
                        <div>
                            <h4 className="text-sm font-extrabold text-slate-900">{selected.title}</h4>
                            <p className="text-[10px] text-slate-400">Asset {assetTag(selected.asset_id)} · what conditions keep this asset at peak?</p>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                                    <th className="py-2 pr-3">Success mode</th>
                                    <th className="py-2 pr-3">Success condition</th>
                                    <th className="py-2 pr-2 text-center" title="Value delivered when sustained (1-10)">V</th>
                                    <th className="py-2 pr-2 text-center" title="How inherently stable the condition is (1-10)">S</th>
                                    <th className="py-2 pr-2 text-center" title="Monitorability — scored directly: 10 = continuously monitorable (1-10)">M</th>
                                    <th className="py-2 pr-3 text-center">SPN</th>
                                    <th className="py-2 pr-3">Priority action</th>
                                    <th className="py-2 pr-3">Status</th>
                                    <th className="py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {items.map(it => (
                                    <tr key={it.id}>
                                        <td className="py-2 pr-3 font-bold text-slate-800">{it.success_mode}</td>
                                        <td className="py-2 pr-3 text-slate-500">{it.success_condition || '—'}</td>
                                        <td className="py-2 pr-2 text-center font-bold">{it.value_impact}</td>
                                        <td className="py-2 pr-2 text-center font-bold">{it.sustainability}</td>
                                        <td className="py-2 pr-2 text-center font-bold">{it.monitorability}</td>
                                        <td className="py-2 pr-3 text-center">
                                            <span className={`px-2 py-0.5 rounded-full font-extrabold ${spnCls(it.spn)}`}>{it.spn}</span>
                                        </td>
                                        <td className="py-2 pr-3 text-slate-500">{it.priority_action || '—'}</td>
                                        <td className="py-2 pr-3">
                                            <select value={it.status}
                                                onChange={async e => {
                                                    const updated = await analyzeService.updateSMEAItem(it.id, { status: e.target.value as SMEAItem['status'] });
                                                    if (updated) setItems(prev => prev.map(x => x.id === it.id ? updated : x));
                                                }}
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border-0 ${STATUS_CLS[it.status]}`}>
                                                {['open', 'monitored', 'sustained', 'dropped'].map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </td>
                                        <td className="py-2 text-right">
                                            <button onClick={async () => { if (await analyzeService.deleteSMEAItem(it.id)) setItems(prev => prev.filter(x => x.id !== it.id)); }}
                                                className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                                        </td>
                                    </tr>
                                ))}
                                {items.length === 0 && (
                                    <tr><td colSpan={9} className="py-6 text-center text-slate-400">No success modes yet — define the first condition below.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Add row */}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-end gap-2">
                        <input value={mode} onChange={e => setMode(e.target.value)} placeholder="Success mode (e.g. Bearing within thermal envelope)"
                            className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg" />
                        <input value={cond} onChange={e => setCond(e.target.value)} placeholder="Condition (e.g. 45-65°C; vib <2.5 mm/s)"
                            className="flex-1 min-w-[170px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg" />
                        <Score value={vi} onChange={setVi} title="Value impact 1-10" />
                        <Score value={su} onChange={setSu} title="Sustainability 1-10" />
                        <Score value={mo} onChange={setMo} title="Monitorability 1-10 (direct)" />
                        <span className={`px-2 py-1 rounded-full text-[10px] font-extrabold ${spnCls(vi * su * mo)}`}>SPN {vi * su * mo}</span>
                        <input value={action} onChange={e => setAction(e.target.value)} placeholder="Priority action (how it's sustained)"
                            className="flex-1 min-w-[170px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg" />
                        <button onClick={addItem} disabled={saving || !mode.trim()}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1">
                            {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Worksheet list ──────────────────────────────────────
    return (
        <div className="space-y-4">
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                <span>
                    <strong>SMEA flips the FMEA lens:</strong> stop only cataloging the ways an asset can fail — define the
                    handful of conditions that keep it at peak, and manage those. Run both: FMEA audits failure, SMEA multiplies
                    excellence. <em>(Potential Success Curve framework — Olorunfemi, 2026)</em>
                </span>
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="New SMEA worksheet title (e.g. P-101 Feed Pump success conditions)"
                    className="flex-1 min-w-[240px] px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                <select value={newAssetId} onChange={e => setNewAssetId(e.target.value)}
                    className="px-2.5 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white max-w-[200px]">
                    <option value="">No linked asset</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                </select>
                <button onClick={createSheet} disabled={creating || !newTitle.trim()}
                    className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1.5">
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} New SMEA
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sheets.map(ws => (
                    <button key={ws.id} onClick={() => setSelected(ws)}
                        className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-sm transition-all">
                        <div className="flex items-center gap-2 mb-1">
                            <Star size={13} className="text-emerald-500" />
                            <span className="text-sm font-extrabold text-slate-900 truncate">{ws.title}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium">Asset {assetTag(ws.asset_id)} · {ws.status}</div>
                    </button>
                ))}
                {sheets.length === 0 && (
                    <div className="col-span-full py-8 text-center text-sm text-slate-400">
                        No SMEA worksheets yet. Create the first one above — start with your most critical asset.
                    </div>
                )}
            </div>
        </div>
    );
};

export default SMEATab;
