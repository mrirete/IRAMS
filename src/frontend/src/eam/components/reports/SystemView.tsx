/**
 * SystemView — Systems-Thinking Phase 3: the RBD as data, in plain language.
 *
 * Each defined system function gets: a traffic light from LIVE member status
 * (open corrective work), "Weakest link: improving X gains the most" from
 * Birnbaum-style importance on live availabilities, and "Backup coverage" per
 * redundancy group. Absolute percentages are labelled estimates (calendar-hour
 * MTBF basis); rankings are the trustworthy part.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Plus, Pencil, Trash2, X, Loader2, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DatabaseService } from '../../services/DatabaseService';
import { isOpenWo } from '../../../lib/woState';
import { computeSystem, type MemberInput, type SystemResult } from '../../lib/systemAvailability';
import { useToast } from '../../contexts/ToastContext';

interface FnRow {
    id: string;
    name: string;
    description?: string;
    system_function_members: { asset_id: string; group_no: number; k_required: number }[];
}

const CORRECTIVE_RE = /CORRECT|BREAK|EMERG|REPAIR|\bCM\b|\bEM\b/;

const STATUS_STYLE: Record<SystemResult['status'], { dot: string; label: string; cls: string }> = {
    ok: { dot: 'bg-emerald-500', label: 'Healthy', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    exposed: { dot: 'bg-amber-500', label: 'Backup consumed', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    lost: { dot: 'bg-red-500', label: 'Function at risk', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export const SystemViewSection: React.FC = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [fns, setFns] = useState<FnRow[]>([]);
    const [assets, setAssets] = useState<any[]>([]);
    const [avail, setAvail] = useState<Map<string, number | null>>(new Map());
    const [downAssets, setDownAssets] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<FnRow | 'new' | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [fnRows, assetRows, relRows, openWos] = await Promise.all([
                db.getSystemFunctions(),
                db.getAssets().catch(() => []),
                supabase.from('sem_asset_reliability').select('asset_id, availability_pct').limit(5000).then(r => r.data || []),
                supabase.from('work_orders').select('asset_id, status, type').limit(5000).then(r => r.data || []),
            ]);
            setFns(fnRows as FnRow[]);
            setAssets(assetRows || []);
            setAvail(new Map((relRows as any[]).map(r => [r.asset_id, r.availability_pct != null ? Number(r.availability_pct) / 100 : null])));
            // "Down" proxy: an OPEN corrective WO against the member — labelled as such.
            const down = new Set<string>();
            for (const w of openWos as any[]) {
                if (w.asset_id && isOpenWo(w.status) && CORRECTIVE_RE.test(String(w.type || '').toUpperCase())) down.add(w.asset_id);
            }
            setDownAssets(down);
        } catch (e) {
            console.warn('[SystemView] load failed:', e);
        }
        setLoading(false);
    }, []);
    useEffect(() => { reload(); }, [reload]);

    const assetById = useMemo(() => new Map(assets.map((a: any) => [a.id, a])), [assets]);

    const computed = useMemo(() => fns.map(fn => {
        const members: MemberInput[] = (fn.system_function_members || []).map(m => ({
            assetId: m.asset_id,
            tag: assetById.get(m.asset_id)?.tag,
            name: assetById.get(m.asset_id)?.name,
            groupNo: m.group_no,
            kRequired: m.k_required,
            availability: avail.has(m.asset_id) ? avail.get(m.asset_id)! : null,
            down: downAssets.has(m.asset_id),
        }));
        return { fn, members, result: computeSystem(members) };
    }), [fns, assetById, avail, downAssets]);

    const remove = async (id: string) => {
        try { await DatabaseService.getInstance().deleteSystemFunction(id); reload(); }
        catch (e: any) { showToast('Delete failed: ' + e.message, 'error'); }
    };

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Boxes size={15} className="text-blue-600" /> System View
                </h3>
                <button
                    onClick={() => setEditing('new')}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                >
                    <Plus size={12} /> Define System
                </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
                What keeps each function running — weakest link and live backup coverage. Availability figures are estimates
                (calendar-hour basis); the <em>rankings</em> are the reliable part.
            </p>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center"><Loader2 size={15} className="animate-spin" /> Computing…</div>
            ) : computed.length === 0 ? (
                <div className="text-center py-8">
                    <Boxes size={22} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500 font-medium">No systems defined yet.</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                        Define a function (e.g. "Cooling water supply") and the equipment that delivers it — including backups
                        (2×100% pumps, 2-of-3 transmitters). You get a live traffic light, the weakest link, and whether the backup is ready.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {computed.map(({ fn, result }) => {
                        const st = STATUS_STYLE[result.status];
                        return (
                            <div key={fn.id} className="border border-slate-200 rounded-lg p-3.5">
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`w-2.5 h-2.5 rounded-full ${st.dot} flex-shrink-0`} />
                                    <span className="font-bold text-sm text-slate-800 truncate flex-1">{fn.name}</span>
                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                                    <button onClick={() => setEditing(fn)} className="p-1 text-slate-400 hover:text-blue-600" title="Edit"><Pencil size={12} /></button>
                                    <button onClick={() => remove(fn.id)} className="p-1 text-slate-400 hover:text-red-600" title="Delete"><Trash2 size={12} /></button>
                                </div>
                                <div className="text-xs text-slate-500 mb-2">
                                    Est. availability <span className="font-bold text-slate-700">{(result.availability * 100).toFixed(1)}%</span>
                                    {result.anyNoData && <span className="text-[10px] text-slate-400 ml-1">(some members have no failure history — assumed healthy)</span>}
                                </div>
                                {result.weakestLink && (
                                    <button
                                        onClick={() => navigate(`/assets?id=${result.weakestLink!.assetId}`)}
                                        className="w-full text-left flex items-start gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5 mb-2 hover:bg-blue-100"
                                    >
                                        <AlertTriangle size={12} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                        <span className="text-[11px] text-blue-800">
                                            <span className="font-bold">Weakest link: {result.weakestLink.tag || result.weakestLink.name}</span> — improving
                                            its reliability gains the most for this function (+{(result.weakestLink.gain * 100).toFixed(2)} pts).
                                        </span>
                                    </button>
                                )}
                                <div className="space-y-1">
                                    {result.groups.map(g => (
                                        <div key={g.groupNo} className="flex items-center gap-2 text-[11px]">
                                            {g.coverage === 'covered' ? <ShieldCheck size={12} className="text-emerald-500 flex-shrink-0" />
                                                : g.coverage === 'no-redundancy' ? <ShieldAlert size={12} className="text-slate-400 flex-shrink-0" />
                                                : <ShieldAlert size={12} className={g.coverage === 'lost' ? 'text-red-500 flex-shrink-0' : 'text-amber-500 flex-shrink-0'} />}
                                            <span className="text-slate-600 truncate flex-1">
                                                {g.members.map(m => m.tag || m.name || m.assetId.slice(0, 6)).join(' / ')}
                                                <span className="text-slate-400 ml-1">(need {g.k} of {g.n})</span>
                                            </span>
                                            <span className={`font-semibold flex-shrink-0 ${g.coverage === 'lost' ? 'text-red-600' : g.coverage === 'exposed' ? 'text-amber-600' : g.coverage === 'no-redundancy' ? 'text-slate-400' : 'text-emerald-600'}`}>
                                                {g.coverage === 'covered' ? 'backup ready'
                                                    : g.coverage === 'exposed' ? '⚠ running without backup'
                                                    : g.coverage === 'lost' ? '✖ below minimum — function at risk'
                                                    : 'no backup by design'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {editing && (
                <SystemEditor
                    fn={editing === 'new' ? null : editing}
                    assets={assets}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); reload(); }}
                />
            )}
        </div>
    );
};

// ── Editor: name + member rows (asset, group, k) ────────────────────────────
const SystemEditor: React.FC<{
    fn: FnRow | null;
    assets: any[];
    onClose: () => void;
    onSaved: () => void;
}> = ({ fn, assets, onClose, onSaved }) => {
    const { showToast } = useToast();
    const [name, setName] = useState(fn?.name || '');
    const [description, setDescription] = useState(fn?.description || '');
    const [rows, setRows] = useState<{ assetId: string; groupNo: number; kRequired: number }[]>(
        (fn?.system_function_members || []).map(m => ({ assetId: m.asset_id, groupNo: m.group_no, kRequired: m.k_required }))
    );
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const members = rows.filter(r => r.assetId);
        if (!name.trim() || members.length === 0) {
            showToast('Give the system a name and at least one member asset.', 'info');
            return;
        }
        setSaving(true);
        try {
            await DatabaseService.getInstance().saveSystemFunction({
                id: fn?.id, name: name.trim(), description: description.trim() || undefined, members,
            });
            onSaved();
        } catch (e: any) {
            showToast('Save failed: ' + e.message, 'error');
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <h3 className="font-bold text-slate-800 text-sm">{fn ? 'Edit System' : 'Define System'}</h3>
                    <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-4 space-y-3 overflow-y-auto">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Function name</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cooling water supply — Unit 1100"
                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Description (optional)</label>
                        <input value={description} onChange={e => setDescription(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Members</label>
                            <button onClick={() => setRows(r => [...r, { assetId: '', groupNo: (r[r.length - 1]?.groupNo || 1), kRequired: 1 }])}
                                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={11} /> Add member</button>
                        </div>
                        <p className="text-[10px] text-slate-400 mb-2">
                            Same <strong>group</strong> = backups of each other (parallel); different groups = all needed (series).
                            <strong> Need</strong> = how many of the group must run (2×100% pumps → group 1, need 1).
                        </p>
                        <div className="space-y-1.5">
                            {rows.map((r, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                    <select value={r.assetId} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, assetId: e.target.value } : x))}
                                        className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white min-w-0">
                                        <option value="">Select asset…</option>
                                        {assets.map((a: any) => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                    </select>
                                    <label className="text-[10px] text-slate-400">grp</label>
                                    <input type="number" min={1} value={r.groupNo}
                                        onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, groupNo: parseInt(e.target.value) || 1 } : x))}
                                        className="w-12 text-xs border border-slate-300 rounded-lg px-1.5 py-1.5 text-center" />
                                    <label className="text-[10px] text-slate-400">need</label>
                                    <input type="number" min={1} value={r.kRequired}
                                        onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, kRequired: parseInt(e.target.value) || 1 } : x))}
                                        className="w-12 text-xs border border-slate-300 rounded-lg px-1.5 py-1.5 text-center" />
                                    <button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>
                                </div>
                            ))}
                            {rows.length === 0 && <p className="text-xs text-slate-400 italic">No members yet.</p>}
                        </div>
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                    <button onClick={save} disabled={saving}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5">
                        {saving && <Loader2 size={11} className="animate-spin" />} Save System
                    </button>
                </div>
            </div>
        </div>
    );
};
