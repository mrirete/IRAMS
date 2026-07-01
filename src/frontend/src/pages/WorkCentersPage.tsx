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
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
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
            )}
        </div>
    );
};
