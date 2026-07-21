import React, { useEffect, useMemo, useState } from 'react';
import { Lock, Shield, CheckCircle, Clock, FileText, XCircle, Plus, X, Ban, Unlock, PlayCircle, Send } from 'lucide-react';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { useToast } from '../eam/contexts/ToastContext';
import { DEMO_DATA, demoSeed } from '../config/demoMode';
import lotoService, { type LotoPermit, type LotoStatus } from '../eam/services/LotoService';
import type { IsolationType } from '../types/safety';

// ═══════════════════════════════════════════════════════════════════════
//  Demo seed — MOCK_LOTO from useSafety, adapted to the loto_permits row
//  shape (issued_at/cleared_at, description, isolation_points JSONB).
//  Only shown in DEMO_DATA mode; production starts empty and loads from DB.
// ═══════════════════════════════════════════════════════════════════════

const d = (off: number) => new Date(Date.now() + off * 86400000).toISOString();

/** Mock asset ids aren't real Supabase UUIDs — resolve display names locally in demo mode. */
const DEMO_ASSET_NAMES: Record<string, string> = {
    'ast-k601': 'Gas Compressor K-601',
    'ast-v205': 'Separator V-205',
    'ast-p102': 'Transfer Pump P-102',
    'ast-hx405': 'Heat Exchanger HX-405',
    'ast-gt301': 'Gas Turbine GT-301',
};

const DEMO_LOTO: LotoPermit[] = [
    { id: 'loto-001', permit_number: 'LOTO-2026-041', asset_id: 'ast-k601', description: 'Motor replacement — K-601 main drive', isolation_points: [{ energy_type: 'electrical' }], padlocks: [{ padlock_id: 'PL-101', assigned_to: 'J. Martinez', locked_date: d(-2), unlocked_date: null }, { padlock_id: 'PL-102', assigned_to: 'D. Chen', locked_date: d(-2), unlocked_date: null }], blind_list: ['BL-001 (24" suction)', 'BL-002 (16" discharge)'], status: 'active', requested_by: 'J. Martinez', authorized_by: 'S. Jenkins', issued_at: d(-2), activated_at: d(-2), cleared_at: null, created_at: d(-3), updated_at: d(-2) },
    { id: 'loto-002', permit_number: 'LOTO-2026-040', asset_id: 'ast-v205', description: 'Internal inspection — UT survey of shell CMLs', isolation_points: [{ energy_type: 'process' }], padlocks: [{ padlock_id: 'PL-103', assigned_to: 'M. Okafor', locked_date: d(-1), unlocked_date: null }], blind_list: ['BL-003 (8" inlet)', 'BL-004 (6" gas outlet)', 'BL-005 (4" drain)'], status: 'active', requested_by: 'M. Okafor', authorized_by: 'N. Nagata', issued_at: d(-1), activated_at: d(-1), cleared_at: null, created_at: d(-2), updated_at: d(-1) },
    { id: 'loto-003', permit_number: 'LOTO-2026-039', asset_id: 'ast-p102', description: 'Seal replacement — mechanical seal overhaul', isolation_points: [{ energy_type: 'mechanical' }], padlocks: [{ padlock_id: 'PL-104', assigned_to: 'A. Burton', locked_date: d(-10), unlocked_date: d(-7) }], blind_list: ['BL-006 (4" suction)'], status: 'cleared', requested_by: 'A. Burton', authorized_by: 'S. Jenkins', issued_at: d(-10), activated_at: d(-10), cleared_at: d(-7), created_at: d(-11), updated_at: d(-7) },
    { id: 'loto-004', permit_number: 'LOTO-2026-042', asset_id: 'ast-hx405', description: 'Tube bundle pull — planned turnaround activity', isolation_points: [{ energy_type: 'process' }], padlocks: [], blind_list: [], status: 'draft', requested_by: 'D. Chen', authorized_by: null, issued_at: null, activated_at: null, cleared_at: null, created_at: d(0), updated_at: d(0) },
    { id: 'loto-005', permit_number: 'LOTO-2026-038', asset_id: 'ast-gt301', description: 'Fuel nozzle inspection and cleaning', isolation_points: [{ energy_type: 'pneumatic' }], padlocks: [{ padlock_id: 'PL-105', assigned_to: 'J. Martinez', locked_date: d(-15), unlocked_date: d(-12) }, { padlock_id: 'PL-106', assigned_to: 'D. Chen', locked_date: d(-15), unlocked_date: d(-12) }], blind_list: ['BL-007 (fuel gas)', 'BL-008 (instrument air)'], status: 'cleared', requested_by: 'J. Martinez', authorized_by: 'N. Nagata', issued_at: d(-15), activated_at: d(-15), cleared_at: d(-12), created_at: d(-16), updated_at: d(-12) },
];

const STATUS_BADGES: Record<LotoStatus, string> = {
    draft: 'text-slate-500 bg-slate-100',
    issued: 'text-blue-500 bg-blue-500/10',
    active: 'text-green-500 bg-green-500/10',
    cleared: 'text-slate-400 bg-slate-100',
    cancelled: 'text-red-400 bg-red-500/10',
};

export const LotoPage: React.FC = () => {
    const { assetOptions, getAssetName } = useAssetLookup();
    const { showToast } = useToast();

    // Supabase-first: start empty (demo seed only in DEMO_DATA), replace with DB rows.
    const [permits, setPermits] = useState<LotoPermit[]>(() => demoSeed(DEMO_LOTO, []));
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ asset_id: '', isolation_type: 'electrical' as IsolationType, description: '', requested_by: '' });
    const [authorizedBy, setAuthorizedBy] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const rows = await lotoService.getPermits();
            if (cancelled) return;
            if (rows.length > 0) setPermits(rows);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const selected = useMemo(() => permits.find(p => p.id === selectedId) ?? null, [permits, selectedId]);

    /** Resolve equipment display name: real asset lookup first, demo map as fallback. */
    const equipmentName = (assetId: string | null): string => {
        if (!assetId) return '—';
        const resolved = getAssetName(assetId);
        return resolved !== assetId ? resolved : (DEMO_ASSET_NAMES[assetId] ?? assetId);
    };

    // ── Create (persisted draft: optimistic + rollback + toast) ───────
    const handleSubmit = async () => {
        if (!form.asset_id || !form.description || !form.requested_by) return;
        const now = new Date().toISOString();
        const temp: LotoPermit = {
            id: `temp-${Date.now()}`,
            permit_number: `LOTO-${new Date().getFullYear()}-${String(permits.length + 41).padStart(3, '0')}`,
            asset_id: form.asset_id,
            description: form.description,
            isolation_points: [{ energy_type: form.isolation_type }],
            padlocks: [], blind_list: [],
            status: 'draft',
            requested_by: form.requested_by,
            authorized_by: null,
            issued_at: null, activated_at: null, cleared_at: null,
            created_at: now, updated_at: now,
        };
        setPermits(prev => [temp, ...prev]);
        setForm({ asset_id: '', isolation_type: 'electrical', description: '', requested_by: '' });
        setShowNew(false);
        if (DEMO_DATA) return;
        const { id: _id, created_at: _c, updated_at: _u, ...payload } = temp;
        const saved = await lotoService.createPermit(payload);
        if (saved) {
            setPermits(prev => prev.map(p => p.id === temp.id ? saved : p));
            setSelectedId(sel => sel === temp.id ? saved.id : sel);
        } else {
            setPermits(prev => prev.filter(p => p.id !== temp.id));
            setSelectedId(sel => sel === temp.id ? null : sel);
            showToast("Couldn't save LOTO permit — the draft was not stored. Check your connection and try again.", 'error', 6000);
        }
    };

    // ── Lifecycle transitions (optimistic + rollback + toast) ─────────
    const transition = async (permit: LotoPermit, updates: Partial<LotoPermit>, label: string) => {
        const rollback = permit;
        setPermits(prev => prev.map(p => p.id === permit.id ? { ...p, ...updates, updated_at: new Date().toISOString() } : p));
        if (DEMO_DATA) { showToast(`Permit ${permit.permit_number} ${label}.`, 'success'); return; }
        const saved = await lotoService.updatePermit(permit.id, updates);
        if (saved) {
            setPermits(prev => prev.map(p => p.id === permit.id ? saved : p));
            showToast(`Permit ${permit.permit_number} ${label}.`, 'success');
        } else {
            setPermits(prev => prev.map(p => p.id === permit.id ? rollback : p));
            showToast(`Couldn't update ${permit.permit_number} — the change was not stored. Check your connection and try again.`, 'error', 6000);
        }
    };

    const issuePermit = (p: LotoPermit) => {
        if (!authorizedBy.trim()) return;
        transition(p, { status: 'issued', issued_at: new Date().toISOString(), authorized_by: authorizedBy.trim() }, 'issued');
        setAuthorizedBy('');
    };
    const activatePermit = (p: LotoPermit) => transition(p, { status: 'active', activated_at: new Date().toISOString() }, 'activated — isolation in force');
    const clearPermit = (p: LotoPermit) => transition(p, { status: 'cleared', cleared_at: new Date().toISOString() }, 'cleared & released');
    const cancelPermit = (p: LotoPermit) => transition(p, { status: 'cancelled' }, 'cancelled');

    const kpis = useMemo(() => ({
        active: permits.filter(p => p.status === 'active').length,
        pending: permits.filter(p => p.status === 'issued').length,
        draft: permits.filter(p => p.status === 'draft').length,
        cleared: permits.filter(p => p.status === 'cleared').length,
    }), [permits]);

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Lockout / Tagout</h1><p className="text-slate-500 text-sm mt-1">OSHA 1910.147 — Energy isolation permits and safe-to-work authorizations</p></div>
                <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New LOTO Permit</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Active Permits" value={kpis.active} icon={Lock} color="text-green-400" bg="bg-green-500/10" />
                <Kpi label="Pending Activation" value={kpis.pending} icon={Clock} color="text-yellow-400" bg="bg-yellow-500/10" />
                <Kpi label="Draft" value={kpis.draft} icon={FileText} />
                <Kpi label="Cleared (Recent)" value={kpis.cleared} icon={CheckCircle} />
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-brand-800/50 border-b border-slate-200">
                        <tr><th className="px-6 py-4">Permit #</th><th className="px-6 py-4">Equipment</th><th className="px-6 py-4">Isolation Type</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Blinds</th><th className="px-6 py-4">Padlocks</th><th className="px-6 py-4 text-right">Authorized By</th></tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {permits.map(p => (
                            <tr key={p.id} onClick={() => { setSelectedId(p.id); setAuthorizedBy(''); }} className="hover:bg-slate-100/30 cursor-pointer transition-colors">
                                <td className="px-6 py-4 font-mono text-slate-800 font-medium">{p.permit_number}</td>
                                <td className="px-6 py-4 text-brand-200">{equipmentName(p.asset_id)}</td>
                                <td className="px-6 py-4"><span className="px-2 py-1 text-xs bg-slate-100 text-brand-300 rounded capitalize">{p.isolation_points[0]?.energy_type ?? '—'}</span></td>
                                <td className="px-6 py-4"><span className={`px-2 py-1 text-xs font-semibold rounded capitalize ${STATUS_BADGES[p.status]}`}>{p.status}</span></td>
                                <td className="px-6 py-4 font-mono text-brand-300">{p.blind_list.length}</td>
                                <td className="px-6 py-4 font-mono text-brand-300">{p.padlocks.length}</td>
                                <td className="px-6 py-4 text-right text-slate-500">{p.authorized_by || '—'}</td>
                            </tr>
                        ))}
                        {!loading && permits.length === 0 && (
                            <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">No LOTO permits yet — create the first energy-isolation permit to get started.</td></tr>
                        )}
                        {loading && permits.length === 0 && (
                            <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">Loading permits…</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selected && (
                <div className="fixed inset-y-0 right-0 w-[520px] bg-slate-50 border-l border-slate-200 shadow-2xl z-40 flex flex-col pt-16 mt-2">
                    <div className="flex justify-between items-center px-6 py-5 border-b border-brand-800 bg-brand-950">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white">{selected.permit_number}</h2>
                                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded capitalize ${STATUS_BADGES[selected.status]}`}>{selected.status}</span>
                            </div>
                            <p className="text-slate-500 text-sm">{equipmentName(selected.asset_id)}</p>
                        </div>
                        <button onClick={() => setSelectedId(null)} className="text-slate-500 hover:text-white"><XCircle size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div className="bg-brand-800 p-4 rounded-lg border border-slate-200"><p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Work Description</p><p className="text-brand-200 text-sm">{selected.description || '—'}</p></div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <MetaField label="Requested By" value={selected.requested_by} />
                            <MetaField label="Authorized By" value={selected.authorized_by} />
                            <MetaField label="Issued" value={selected.issued_at ? new Date(selected.issued_at).toLocaleString() : null} />
                            <MetaField label="Isolation Active" value={selected.activated_at ? new Date(selected.activated_at).toLocaleString() : null} />
                            <MetaField label="Cleared" value={selected.cleared_at ? new Date(selected.cleared_at).toLocaleString() : null} />
                            <MetaField label="Isolation Type" value={selected.isolation_points[0]?.energy_type ?? null} capitalize />
                        </div>

                        <section>
                            <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-3 flex items-center"><Shield size={14} className="mr-2 text-accent-cyan" />Blind List</h3>
                            <div className="space-y-2">{selected.blind_list.length ? selected.blind_list.map((b, i) => <div key={i} className="bg-brand-800 p-3 rounded border border-slate-200 text-brand-200 text-sm font-mono">{b}</div>) : <p className="text-slate-400 text-sm italic">No blinds specified</p>}</div>
                        </section>
                        <section>
                            <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-3 flex items-center"><Lock size={14} className="mr-2 text-accent-cyan" />Padlock Registry</h3>
                            <div className="space-y-2">{selected.padlocks.length ? selected.padlocks.map(p => (
                                <div key={p.padlock_id} className="bg-brand-800 p-3 rounded border border-slate-200 flex justify-between items-center">
                                    <div><p className="text-slate-800 font-mono text-sm">{p.padlock_id}</p><p className="text-slate-400 text-xs">{p.assigned_to}</p></div>
                                    <div className="text-right text-xs font-mono">{p.unlocked_date ? <span className="text-slate-500">Returned {new Date(p.unlocked_date).toLocaleDateString()}</span> : <span className="text-yellow-400 font-semibold">🔒 Active</span>}</div>
                                </div>
                            )) : <p className="text-slate-400 text-sm italic">No padlocks assigned</p>}</div>
                        </section>

                        {/* ── Lifecycle actions ── */}
                        {selected.status === 'draft' && (
                            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                                <p className="text-xs font-semibold text-brand-300 uppercase tracking-widest">Issue Permit</p>
                                <p className="text-slate-500 text-xs">Issuing authorizes this isolation plan for execution. Enter the authorizing person to proceed.</p>
                                <input type="text" value={authorizedBy} onChange={e => setAuthorizedBy(e.target.value)} placeholder="Authorized by — e.g. S. Jenkins" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                                <button onClick={() => issuePermit(selected)} disabled={!authorizedBy.trim()} className="w-full flex items-center justify-center px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"><Send size={15} className="mr-2" />Issue Permit</button>
                            </div>
                        )}

                        {selected.status === 'issued' && (
                            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                                <p className="text-xs font-semibold text-brand-300 uppercase tracking-widest">Activate Isolation</p>
                                <p className="text-slate-500 text-xs">Confirm all energy sources are locked out, tags applied, and zero-energy state verified before activating.</p>
                                <button onClick={() => activatePermit(selected)} className="w-full flex items-center justify-center px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"><PlayCircle size={15} className="mr-2" />Activate Isolation</button>
                            </div>
                        )}

                        {selected.status === 'active' && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
                                <p className="text-yellow-600 text-sm font-semibold">⚠ Gatekeeper Authorization Required</p>
                                <p className="text-yellow-700/70 text-xs">Clearing this LOTO permit requires verification that all energy sources are de-isolated, padlocks removed, and safe-to-work conditions are restored.</p>
                                <button onClick={() => clearPermit(selected)} className="w-full flex items-center justify-center px-4 py-2.5 bg-yellow-600 text-white text-sm font-semibold rounded-lg hover:bg-yellow-700 transition-colors"><Unlock size={15} className="mr-2" />Clear &amp; Release</button>
                            </div>
                        )}

                        {selected.status !== 'cleared' && selected.status !== 'cancelled' && (
                            <button onClick={() => cancelPermit(selected)} className="w-full flex items-center justify-center px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-500/10 transition-colors"><Ban size={14} className="mr-2" />Cancel Permit</button>
                        )}

                        {(selected.status === 'cleared' || selected.status === 'cancelled') && (
                            <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 text-center">
                                <p className="text-slate-500 text-sm">{selected.status === 'cleared' ? 'Permit cleared — equipment released back to service.' : 'Permit cancelled — no isolation in force.'}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-accent-cyan/10 rounded-lg text-accent-cyan"><Lock size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New LOTO Permit</h2><p className="text-xs text-slate-500 mt-0.5">OSHA 1910.147 energy isolation — starts as a draft</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Equipment</label>
                                <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                    <option value="">Select equipment…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Isolation Type</label>
                                <select value={form.isolation_type} onChange={e => setForm(f => ({ ...f, isolation_type: e.target.value as IsolationType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500">
                                    <option value="electrical">Electrical</option><option value="mechanical">Mechanical</option><option value="process">Process</option><option value="pneumatic">Pneumatic</option><option value="hydraulic">Hydraulic</option>
                                </select>
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Work Description</label>
                                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the work requiring isolation…" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500 resize-none" />
                            </div>
                            <div><label className="block text-xs font-bold text-brand-300 uppercase tracking-wider mb-2">Requested By</label>
                                <input type="text" value={form.requested_by} onChange={e => setForm(f => ({ ...f, requested_by: e.target.value }))} placeholder="e.g. J. Martinez" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-relantern-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-brand-200 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.asset_id || !form.description || !form.requested_by} className="px-6 py-2.5 bg-accent-cyan text-white text-sm font-semibold rounded-lg hover:bg-accent-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Create Draft Permit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

function MetaField({ label, value, capitalize = false }: { label: string; value: string | null; capitalize?: boolean }) {
    return (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
            <p className="text-[10px] text-slate-400 uppercase font-semibold mb-0.5">{label}</p>
            <p className={`text-slate-700 text-xs font-medium ${capitalize ? 'capitalize' : ''}`}>{value || '—'}</p>
        </div>
    );
}

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-accent-blue/10' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center shadow-sm"><div className={`p-3 rounded-md ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-brand-50 tracking-tight">{value}</h3></div></div>);
}
