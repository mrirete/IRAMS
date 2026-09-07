/**
 * CompaniesPage — Admin editor for the workspace's own company record.
 *
 * History, so the shape makes sense: 0173 built `companies` as SAP Company
 * Codes (BUKRS) — several legal entities under one deployment. The shared-DB
 * tenancy work (0258–0279) then made `companies.id` THE tenant key: a user's
 * JWT carries one company_id and the select policy (0273) returns only that
 * row. So today one workspace == one company, and this page edits that single
 * record. There is deliberately no Add (no INSERT policy — tenants are created
 * by provision_tenant()/signup), no Deactivate and no Active toggle (a tenant
 * switching itself off would vanish from its own scope pickers). Sub-companies
 * under one group need the reserved companies.tenant_id and a tenant-level
 * claim; that is not built, and this page says so rather than pretending.
 *
 * Degrades gracefully before migration 0173 is applied: getCompanies() returns
 * [] on a missing table, and this page shows an "apply the migration" notice
 * instead of an error.
 */
import React, { useEffect, useState } from 'react';
import { Building2, Save, Loader2, Info } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import type { Company } from '../eam/types';

type Row = Company;

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
            showToast('Company details saved', 'success');
            load();
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const inputCls = 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded-md focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none';
    // Phone card fields: taller than the table's inputs so they are thumb-sized,
    // and labelled, since the card list has no column headers to inherit from.
    const mInput = 'w-full h-11 text-[15px] px-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-200 focus:border-primary-400 outline-none';
    const mLabel = 'block text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mb-1';

    return (
        <div className="space-y-5 ers-page-record">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Building2 size={20} className="text-primary-600" /> Your Company
                    </h1>
                    <p className="text-xs text-slate-500">The legal entity this workspace belongs to. Its code, country and currency drive numbering and reporting. One workspace is one company; several company codes under one group are not supported yet.</p>
                </div>
                {tableReady && rows.length > 0 && (
                    <div className="flex items-center gap-2">
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
                <>
                {/* ── Phone: one stacked card per company ──
                     The table is an editable seven-column grid ~700px wide. Inside a
                     sideways scroller that means editing one company by dragging the
                     viewport field to field, with the column headers scrolled out of
                     sight, so you cannot see which box you are typing into. Cards
                     label every field and keep the row's delete on screen. */}
                <div className="sm:hidden bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {rows.length === 0 && (
                        <p className="px-4 py-8 text-center text-slate-400 text-sm">No company record is visible to your account. The workspace was provisioned without one, or your user has no tenant assigned — see Admin › Ops Health.</p>
                    )}
                    {rows.map((r, idx) => (
                        <div key={r.id} className="p-4 space-y-3">
                            <div className="flex items-start gap-2">
                                <div className="w-24 shrink-0">
                                    <label className={mLabel}>Code</label>
                                    <input className={mInput + ' font-mono uppercase'} value={r.code}
                                        onChange={e => update(idx, { code: e.target.value })} placeholder="1000" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <label className={mLabel}>Name</label>
                                    <input className={mInput} value={r.name}
                                        onChange={e => update(idx, { name: e.target.value })} placeholder="Cainergy Nigeria Ltd" />
                                </div>
                            </div>
                            <div>
                                <label className={mLabel}>Description</label>
                                <input className={mInput} value={r.description || ''}
                                    onChange={e => update(idx, { description: e.target.value })} placeholder="Optional" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className={mLabel}>Country</label>
                                    <input className={mInput} value={r.country || ''}
                                        onChange={e => update(idx, { country: e.target.value })} placeholder="NG" />
                                </div>
                                <div>
                                    <label className={mLabel}>Currency</label>
                                    <input className={mInput + ' font-mono uppercase'} maxLength={3} value={r.currency || ''}
                                        onChange={e => update(idx, { currency: e.target.value })} placeholder="NGN" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="hidden sm:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                                <th className="px-3 py-2.5">Code</th>
                                <th className="px-3 py-2.5">Name</th>
                                <th className="px-3 py-2.5">Description</th>
                                <th className="px-3 py-2.5">Country</th>
                                <th className="px-3 py-2.5">Currency</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No company record is visible to your account. The workspace was provisioned without one, or your user has no tenant assigned — see Admin › Ops Health.</td></tr>
                            )}
                            {rows.map((r, idx) => (
                                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                                    <td className="px-3 py-2 w-32"><input className={inputCls + ' font-mono uppercase'} value={r.code} onChange={e => update(idx, { code: e.target.value })} placeholder="1000" /></td>
                                    <td className="px-3 py-2 min-w-[180px]"><input className={inputCls} value={r.name} onChange={e => update(idx, { name: e.target.value })} placeholder="Cainergy Nigeria Ltd" /></td>
                                    <td className="px-3 py-2 min-w-[180px]"><input className={inputCls} value={r.description || ''} onChange={e => update(idx, { description: e.target.value })} placeholder="Optional" /></td>
                                    <td className="px-3 py-2 w-24"><input className={inputCls} value={r.country || ''} onChange={e => update(idx, { country: e.target.value })} placeholder="NG" /></td>
                                    <td className="px-3 py-2 w-24"><input className={inputCls + ' font-mono uppercase'} maxLength={3} value={r.currency || ''} onChange={e => update(idx, { currency: e.target.value })} placeholder="NGN" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </div>
    );
};
