/**
 * CompaniesPage — Admin editor for Company Codes (SAP BUKRS / sub-companies).
 *
 * The enterprise-structure tier (design T-0): one deployment can serve a parent
 * with multiple sub-companies / legal entities, each owning its own org units
 * (sites/areas) and — via the scope keys on numbering_config/hierarchy_config —
 * its own numbering framework and configuration, with group-level rollup.
 *
 * Degrades gracefully before migration 0173 is applied: getCompanies() returns
 * [] on a missing table, and this page shows an "apply the migration" notice
 * instead of an error.
 */
import React, { useEffect, useState } from 'react';
import { Building2, Save, Loader2, Plus, Trash2, Info } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import type { Company } from '../eam/types';

type Row = Company & { _new?: boolean };

export const CompaniesPage: React.FC = () => {
    const { showToast } = useToast();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [tableReady, setTableReady] = useState(true);

    const load = async () => {
        setLoading(true);
        const db = DatabaseService.getInstance();
        const companies = await db.getCompanies(false);
        // getCompanies returns [] both for "no rows" and "table absent"; probe once
        // to distinguish so we can show the right empty state.
        setRows(companies);
        setTableReady(companies.length > 0 || (await probeTable(db)));
        setLoading(false);
    };
    // A cheap existence probe: try a single insert-shaped no-op read path.
    const probeTable = async (_db: DatabaseService): Promise<boolean> => {
        try {
            const { supabase } = await import('../eam/lib/supabase');
            const { error } = await supabase.from('companies').select('id', { head: true, count: 'exact' });
            return !(error && (error.code === 'PGRST205' || error.code === '42P01'));
        } catch { return false; }
    };

    useEffect(() => { load(); }, []);

    const update = (idx: number, patch: Partial<Row>) =>
        setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const addRow = () =>
        setRows(prev => [...prev, { id: '', code: '', name: '', active: true, _new: true }]);

    const removeRow = async (idx: number) => {
        const row = rows[idx];
        if (row._new || !row.id) { setRows(prev => prev.filter((_, i) => i !== idx)); return; }
        if (!confirm(`Deactivate company ${row.code}? Org units referencing it are preserved.`)) return;
        try {
            await DatabaseService.getInstance().deleteCompany(row.id);
            showToast(`${row.code} deactivated`, 'success');
            load();
        } catch (e: any) { showToast('Deactivate failed: ' + (e?.message || 'unknown'), 'error'); }
    };

    const handleSave = async () => {
        const codes = rows.map(r => (r.code || '').trim().toUpperCase());
        if (codes.some(c => !c)) { showToast('Every company needs a code.', 'error'); return; }
        if (rows.some(r => !(r.name || '').trim())) { showToast('Every company needs a name.', 'error'); return; }
        if (new Set(codes).size !== codes.length) { showToast('Company codes must be unique.', 'error'); return; }
        setSaving(true);
        try {
            const db = DatabaseService.getInstance();
            for (const r of rows) {
                await db.saveCompany({
                    id: r.id || undefined,
                    code: (r.code || '').trim().toUpperCase(),
                    name: (r.name || '').trim(),
                    description: r.description,
                    country: r.country,
                    currency: r.currency?.trim().toUpperCase(),
                    active: r.active !== false,
                });
            }
            showToast('Companies saved', 'success');
            load();
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const inputCls = 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none';

    return (
        <div className="space-y-5 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Building2 size={20} className="text-primary-600" /> Companies
                    </h1>
                    <p className="text-xs text-slate-500">Sub-companies / legal entities (SAP Company Code). Org units, numbering, and configuration can be assigned per company, with group-level rollup across them.</p>
                </div>
                {tableReady && (
                    <div className="flex items-center gap-2">
                        <button onClick={addRow} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                            <Plus size={14} /> Add
                        </button>
                        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-60">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                        </button>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading…</div>
            ) : !tableReady ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
                    <Info size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-900">
                        <p className="font-semibold">Company Code tier not yet enabled on this deployment.</p>
                        <p className="mt-1 text-amber-800">Apply migration <code className="font-mono bg-amber-100 px-1 rounded">0173_company_code_tier.sql</code> in the Supabase SQL editor to create the <code className="font-mono">companies</code> table and link your org units. A default “MAIN” company is seeded automatically; rename it here afterward.</p>
                    </div>
                </div>
            ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                                <th className="px-3 py-2.5">Code</th>
                                <th className="px-3 py-2.5">Name</th>
                                <th className="px-3 py-2.5">Description</th>
                                <th className="px-3 py-2.5">Country</th>
                                <th className="px-3 py-2.5">Currency</th>
                                <th className="px-3 py-2.5 text-center">Active</th>
                                <th className="px-3 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No companies yet — click Add.</td></tr>
                            )}
                            {rows.map((r, idx) => (
                                <tr key={r.id || `new-${idx}`} className="border-b border-slate-50 last:border-0">
                                    <td className="px-3 py-2 w-32"><input className={inputCls + ' font-mono uppercase'} value={r.code} onChange={e => update(idx, { code: e.target.value })} placeholder="1000" /></td>
                                    <td className="px-3 py-2 min-w-[180px]"><input className={inputCls} value={r.name} onChange={e => update(idx, { name: e.target.value })} placeholder="Cainergy Nigeria Ltd" /></td>
                                    <td className="px-3 py-2 min-w-[180px]"><input className={inputCls} value={r.description || ''} onChange={e => update(idx, { description: e.target.value })} placeholder="Optional" /></td>
                                    <td className="px-3 py-2 w-24"><input className={inputCls} value={r.country || ''} onChange={e => update(idx, { country: e.target.value })} placeholder="NG" /></td>
                                    <td className="px-3 py-2 w-24"><input className={inputCls + ' font-mono uppercase'} maxLength={3} value={r.currency || ''} onChange={e => update(idx, { currency: e.target.value })} placeholder="NGN" /></td>
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
