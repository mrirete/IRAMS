/**
 * WorkCentersPage — Admin master-data editor for Work Centers (WM-2a, SAP CR).
 *
 * A work center is the capacity-bearing, costed resource an operation is performed
 * at. It carries a planned costing rate and daily capacity, and a default cost
 * center that the order-to-cost spine (confirmations -> settlement) will use.
 */
import React, { useEffect, useState } from 'react';
import { Factory, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { FinOpsService } from '../eam/services/FinOpsService';
import { useToast } from '../eam/contexts/ToastContext';
import type { WorkCenter } from '../eam/types';

type Row = WorkCenter & { _new?: boolean };

export const WorkCentersPage: React.FC = () => {
    const { showToast } = useToast();
    const [rows, setRows] = useState<Row[]>([]);
    const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
    const [costCenters, setCostCenters] = useState<{ id: string; code: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        const db = DatabaseService.getInstance();
        const [wcs, orgUnits, ccs] = await Promise.all([
            db.getWorkCenters(false),
            db.getOrgUnits().catch(() => []),
            FinOpsService.getCostCenters().catch(() => []),
        ]);
        setRows(wcs);
        setSites((orgUnits as any[]).map(o => ({ id: o.id, name: o.name })));
        setCostCenters((ccs as any[]).map(c => ({ id: c.id, code: c.code, name: c.name })));
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const update = (idx: number, patch: Partial<Row>) =>
        setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const addRow = () =>
        setRows(prev => [...prev, {
            id: '', code: '', name: '', activityRate: 0, capacityHoursPerDay: 8, active: true, _new: true,
        }]);

    const removeRow = async (idx: number) => {
        const row = rows[idx];
        if (row._new || !row.id) { setRows(prev => prev.filter((_, i) => i !== idx)); return; }
        if (!confirm(`Deactivate work center ${row.code}? Existing operation history is preserved.`)) return;
        try {
            await DatabaseService.getInstance().deleteWorkCenter(row.id);
            showToast(`${row.code} deactivated`, 'success');
            load();
        } catch (e: any) { showToast('Deactivate failed: ' + (e?.message || 'unknown'), 'error'); }
    };

    const handleSave = async () => {
        const codes = rows.map(r => (r.code || '').trim().toUpperCase());
        if (codes.some(c => !c)) { showToast('Every work center needs a code.', 'error'); return; }
        if (rows.some(r => !(r.name || '').trim())) { showToast('Every work center needs a name.', 'error'); return; }
        if (new Set(codes).size !== codes.length) { showToast('Work center codes must be unique.', 'error'); return; }
        setSaving(true);
        try {
            const db = DatabaseService.getInstance();
            for (const r of rows) {
                await db.saveWorkCenter({
                    id: r.id || undefined,
                    code: (r.code || '').trim().toUpperCase(),
                    name: (r.name || '').trim(),
                    siteId: r.siteId,
                    costCenterId: r.costCenterId,
                    activityRate: Number(r.activityRate) || 0,
                    capacityHoursPerDay: Number(r.capacityHoursPerDay) || 0,
                    category: r.category,
                    active: r.active !== false,
                });
            }
            showToast('Work centers saved', 'success');
            load();
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const inputCls = 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none';
    // Phone card fields: thumb-sized, and labelled, since the card list has no
    // column headers to inherit meaning from.
    const mInput = 'w-full h-11 text-[15px] px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none';
    const mLabel = 'block text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-1';

    return (
        <div className="space-y-5 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Factory size={20} className="text-primary-600" /> Work Centers
                    </h1>
                    <p className="text-xs text-slate-500">Capacity-bearing, costed resources that operations are performed at. Rate and capacity feed scheduling and the order-to-cost roll-up.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={addRow} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                        <Plus size={14} /> Add
                    </button>
                    <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-60">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : (
                <>
                {/* ── Phone: one stacked card per work center ──
                     Nine editable columns is ~710px. In a sideways scroller you would
                     set a rate with the "Rate /hr" header dragged out of view, next to
                     an identical-looking capacity box. Cards label every field. */}
                <div className="sm:hidden bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {rows.length === 0 && (
                        <p className="px-4 py-8 text-center text-slate-400 text-sm">No work centers yet — tap Add.</p>
                    )}
                    {rows.map((r, idx) => (
                        <div key={r.id || `m-new-${idx}`} className="p-4 space-y-3">
                            <div className="flex items-start gap-2">
                                <div className="w-28 shrink-0">
                                    <label className={mLabel}>Code</label>
                                    <input className={mInput + ' font-mono uppercase'} value={r.code}
                                        onChange={e => update(idx, { code: e.target.value })} placeholder="MECH-01" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <label className={mLabel}>Name</label>
                                    <input className={mInput} value={r.name}
                                        onChange={e => update(idx, { name: e.target.value })} placeholder="Mechanical Maintenance" />
                                </div>
                                <button onClick={() => removeRow(idx)} title="Deactivate"
                                    className="mt-5 h-11 w-9 shrink-0 inline-flex items-center justify-center text-slate-400 active:text-red-600">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div>
                                <label className={mLabel}>Category</label>
                                <input className={mInput} value={r.category || ''}
                                    onChange={e => update(idx, { category: e.target.value })} placeholder="MECHANICAL" />
                            </div>
                            <div>
                                <label className={mLabel}>Site</label>
                                <select className={mInput} value={r.siteId || ''}
                                    onChange={e => update(idx, { siteId: e.target.value || undefined })}>
                                    <option value="">—</option>
                                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={mLabel}>Cost Center</label>
                                <select className={mInput} value={r.costCenterId || ''}
                                    onChange={e => update(idx, { costCenterId: e.target.value || undefined })}>
                                    <option value="">—</option>
                                    {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className={mLabel}>Rate /hr</label>
                                    <input type="number" min={0} step="0.01" className={mInput} value={r.activityRate}
                                        onChange={e => update(idx, { activityRate: Number(e.target.value) })} />
                                </div>
                                <div>
                                    <label className={mLabel}>Capacity h/day</label>
                                    <input type="number" min={0} step="0.5" className={mInput} value={r.capacityHoursPerDay}
                                        onChange={e => update(idx, { capacityHoursPerDay: Number(e.target.value) })} />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-[13px] font-medium text-slate-600 pt-0.5">
                                <input type="checkbox" checked={r.active !== false}
                                    onChange={e => update(idx, { active: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-400" />
                                Active
                            </label>
                        </div>
                    ))}
                </div>

                <div className="hidden sm:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                                <th className="px-3 py-2.5">Code</th>
                                <th className="px-3 py-2.5">Name</th>
                                <th className="px-3 py-2.5">Category</th>
                                <th className="px-3 py-2.5">Site</th>
                                <th className="px-3 py-2.5">Cost Center</th>
                                <th className="px-3 py-2.5 text-right">Rate /hr</th>
                                <th className="px-3 py-2.5 text-right">Capacity h/day</th>
                                <th className="px-3 py-2.5 text-center">Active</th>
                                <th className="px-3 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No work centers yet — click Add.</td></tr>
                            )}
                            {rows.map((r, idx) => (
                                <tr key={r.id || `new-${idx}`} className="border-b border-slate-50 last:border-0">
                                    <td className="px-3 py-2 w-28"><input className={inputCls + ' font-mono uppercase'} value={r.code} onChange={e => update(idx, { code: e.target.value })} placeholder="MECH-01" /></td>
                                    <td className="px-3 py-2 min-w-[180px]"><input className={inputCls} value={r.name} onChange={e => update(idx, { name: e.target.value })} placeholder="Mechanical Maintenance" /></td>
                                    <td className="px-3 py-2 w-36"><input className={inputCls} value={r.category || ''} onChange={e => update(idx, { category: e.target.value })} placeholder="MECHANICAL" /></td>
                                    <td className="px-3 py-2 w-40">
                                        <select className={inputCls} value={r.siteId || ''} onChange={e => update(idx, { siteId: e.target.value || undefined })}>
                                            <option value="">—</option>
                                            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2 w-44">
                                        <select className={inputCls} value={r.costCenterId || ''} onChange={e => update(idx, { costCenterId: e.target.value || undefined })}>
                                            <option value="">—</option>
                                            {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2 w-24"><input type="number" min={0} step="0.01" className={inputCls + ' text-right'} value={r.activityRate} onChange={e => update(idx, { activityRate: Number(e.target.value) })} /></td>
                                    <td className="px-3 py-2 w-24"><input type="number" min={0} step="0.5" className={inputCls + ' text-right'} value={r.capacityHoursPerDay} onChange={e => update(idx, { capacityHoursPerDay: Number(e.target.value) })} /></td>
                                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={r.active !== false} onChange={e => update(idx, { active: e.target.checked })} className="rounded border-slate-300 text-primary-600 focus:ring-primary-400" /></td>
                                    <td className="px-3 py-2 text-center"><button onClick={() => removeRow(idx)} className="text-slate-400 hover:text-red-600" title="Deactivate"><Trash2 size={15} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}

            {/* ── Crew: the people ↔ work-center intersection (0191) ──
                Org units say who you ARE; work centers say who DOES the work.
                Each member row shows their org-chart home, so the overlap is
                visible: a crew is drawn FROM org units, but exists apart. */}
            {!loading && <CrewPanel workCenters={rows.filter(r => !r._new && r.id)} orgUnits={sites} />}
        </div>
    );
};

const CrewPanel: React.FC<{
    workCenters: { id?: string; code: string; name: string }[];
    orgUnits: { id: string; name: string }[];
}> = ({ workCenters, orgUnits }) => {
    const { showToast } = useToast();
    const [wcId, setWcId] = useState('');
    const [members, setMembers] = useState<{ workCenterId: string; contactId: string; role: 'MEMBER' | 'LEAD' }[]>([]);
    const [contacts, setContacts] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        DatabaseService.getInstance().getContacts().then(cs =>
            setContacts((cs as any[]).filter(c => c.active !== false && !(c.types || []).includes('MANUFACTURER')))
        ).catch(() => {});
    }, []);
    useEffect(() => {
        if (!workCenters.length) return;
        if (!wcId) { setWcId(workCenters[0].id as string); return; }
        DatabaseService.getInstance().getWorkCenterMembers(wcId).then(setMembers);
    }, [wcId, workCenters.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const orgName = (c: any) => orgUnits.find(o => o.id === c.organizationUnitId)?.name;
    const memberContacts = members
        .map(m => ({ m, c: contacts.find(c => c.id === m.contactId) }))
        .filter(x => x.c);
    const candidates = search.trim()
        ? contacts.filter(c => !members.some(m => m.contactId === c.id) &&
            (c.name?.toLowerCase().includes(search.toLowerCase()) || c.code?.toLowerCase().includes(search.toLowerCase()))).slice(0, 6)
        : [];

    const add = async (contactId: string) => {
        if (!wcId) return;
        setBusy(true);
        const ok = await DatabaseService.getInstance().addWorkCenterMember(wcId, contactId);
        setBusy(false);
        if (!ok) { showToast('Could not add crew member (admin only — and check migration 0191 is applied).', 'error'); return; }
        setSearch('');
        setMembers(await DatabaseService.getInstance().getWorkCenterMembers(wcId));
    };
    const remove = async (contactId: string) => {
        if (!wcId) return;
        if (await DatabaseService.getInstance().removeWorkCenterMember(wcId, contactId)) {
            setMembers(prev => prev.filter(m => m.contactId !== contactId));
        }
    };
    const setRole = async (contactId: string, role: 'MEMBER' | 'LEAD') => {
        if (!wcId) return;
        if (await DatabaseService.getInstance().addWorkCenterMember(wcId, contactId, role)) {
            setMembers(prev => prev.map(m => m.contactId === contactId ? { ...m, role } : m));
        }
    };

    if (!workCenters.length) return null;
    return (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <div>
                    <h3 className="text-sm font-extrabold text-slate-900">Crew</h3>
                    <p className="text-[11px] text-slate-500">Assign people to this work center. Their org-chart home stays untouched — a person can serve on several crews.</p>
                </div>
                {/* Full width on a phone: the select sizes to its longest option
                    ("ELEC-01 — Electrical Maintenance"), which pushed it past the
                    card's right edge. */}
                <select value={wcId} onChange={e => setWcId(e.target.value)}
                    className="w-full sm:w-auto max-w-full min-w-0 truncate px-2.5 h-10 sm:h-auto sm:py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white">
                    {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
            </div>

            <div className="mt-3 space-y-1.5">
                {memberContacts.map(({ m, c }) => (
                    <div key={m.contactId} className="flex flex-wrap items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg">
                        <span className="text-sm font-bold text-slate-800">{c.name}</span>
                        {orgName(c) && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title="Org-chart home (People & Org)">
                                {orgName(c)}
                            </span>
                        )}
                        <span className="ml-auto flex items-center gap-1.5">
                            <button onClick={() => setRole(m.contactId, m.role === 'LEAD' ? 'MEMBER' : 'LEAD')}
                                className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${m.role === 'LEAD' ? 'bg-relantern-50 border-relantern-300 text-relantern-700' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}
                                title="Toggle crew lead">
                                {m.role === 'LEAD' ? '★ LEAD' : 'member'}
                            </button>
                            <button onClick={() => remove(m.contactId)} className="text-slate-300 hover:text-red-500" title="Remove from crew"><Trash2 size={13} /></button>
                        </span>
                    </div>
                ))}
                {memberContacts.length === 0 && (
                    <p className="text-xs text-slate-400 py-2">No crew assigned yet — search below to add people.</p>
                )}
            </div>

            <div className="mt-3 relative max-w-sm">
                <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Add person — search name or code…"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
                {candidates.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
                        {candidates.map(c => (
                            <button key={c.id} disabled={busy} onClick={() => add(c.id)}
                                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary-50 text-sm disabled:opacity-50">
                                <span className="font-semibold text-slate-800">{c.name}</span>
                                {orgName(c) && <span className="text-[10px] text-slate-400">{orgName(c)}</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
