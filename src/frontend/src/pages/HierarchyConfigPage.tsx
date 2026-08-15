/**
 * HierarchyConfigPage — Admin editor for the asset hierarchy level model (UAT F-010).
 *
 * Edits the single source of truth (hierarchyModel): per-level label, object class
 * (FLOC vs Equipment — which drives numbering + equipment-field visibility), and the
 * criticality rule. Saves to hierarchy_config and applies live via setLevelModel.
 */
import React, { useEffect, useState } from 'react';
import { Layers, Save, Loader2, RotateCcw, CheckCircle, Info, Hash, Plus, Trash2 } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import { getLevels, DEFAULT_LEVELS, setLevelModel, type LevelConfig } from '../eam/services/hierarchyModel';

export const HierarchyConfigPage: React.FC = () => {
    const { showToast } = useToast();
    const [levels, setLevels] = useState<LevelConfig[]>(() => getLevels().map(l => ({ ...l })));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    // Codes that already exist (in the DB/config) — their code is locked to avoid
    // orphaning assets; newly added levels have an editable code.
    const [originalCodes, setOriginalCodes] = useState<Set<string>>(() => new Set(getLevels().map(l => l.code)));

    useEffect(() => {
        DatabaseService.getInstance().getHierarchyConfig()
            .then(cfg => { if (cfg && cfg.length) { setLevels(cfg as LevelConfig[]); setOriginalCodes(new Set((cfg as LevelConfig[]).map(l => l.code))); } })
            .finally(() => setLoading(false));
    }, []);

    const update = (idx: number, patch: Partial<LevelConfig>) => {
        setLevels(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
        setSaved(false);
    };

    const addLevel = () => {
        const maxIso = levels.reduce((m, l) => Math.max(m, l.isoLevel || 0), 0);
        setLevels(prev => [...prev, { code: '', isoLevel: maxIso + 1, label: '', objectClass: 'FLOC', numbering: 'FL', criticality: 'optional', showEquipmentFields: false, allowedChildCodes: [] }]);
        setSaved(false);
    };

    const removeLevel = (idx: number) => {
        setLevels(prev => prev.filter((_, i) => i !== idx));
        setSaved(false);
    };

    const toggleChild = (idx: number, childCode: string) => {
        setLevels(prev => prev.map((l, i) => {
            if (i !== idx) return l;
            const has = l.allowedChildCodes.includes(childCode);
            return { ...l, allowedChildCodes: has ? l.allowedChildCodes.filter(c => c !== childCode) : [...l.allowedChildCodes, childCode] };
        }));
        setSaved(false);
    };

    // Numbering + field visibility derive from object class so the model stays consistent.
    const normalize = (l: LevelConfig): LevelConfig => ({
        ...l,
        numbering: l.objectClass === 'EQUIPMENT' ? 'EQ' : 'FL',
        // F-002: field visibility is independently configurable per level; default to
        // the object class only when unset.
        showEquipmentFields: typeof l.showEquipmentFields === 'boolean' ? l.showEquipmentFields : l.objectClass === 'EQUIPMENT',
    });

    const handleSave = async () => {
        const codes = levels.map(l => (l.code || '').trim().toUpperCase());
        if (codes.some(c => !c)) { showToast('Every level needs a code.', 'error'); return; }
        if (new Set(codes).size !== codes.length) { showToast('Level codes must be unique.', 'error'); return; }
        setSaving(true);
        try {
            const normalized = levels.map((l, i) => normalize({
                ...l,
                code: codes[i],
                allowedChildCodes: (l.allowedChildCodes || []).map(c => c.toUpperCase()),
            }));
            await DatabaseService.getInstance().saveHierarchyConfig(normalized);
            setLevelModel(normalized);
            setLevels(normalized);
            setOriginalCodes(new Set(codes));
            setSaved(true);
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => { setLevels(DEFAULT_LEVELS.map(l => ({ ...l }))); setOriginalCodes(new Set(DEFAULT_LEVELS.map(l => l.code))); setSaved(false); };

    return (
        <div className="space-y-5 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Layers size={20} className="text-primary-600" /> Hierarchy Configuration
                    </h1>
                    <p className="text-xs text-slate-500">The single source of truth for level behaviour — numbering, field visibility, criticality and child rules all derive from this.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleReset} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                        <RotateCcw size={14} /> Reset to default
                    </button>
                    <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 shadow-sm disabled:opacity-50">
                        {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
                        {saved ? 'Saved' : 'Save & apply'}
                    </button>
                </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-[12px] text-blue-800">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span><strong>Object class</strong> sets whether a level is a Functional Location (FLOC → <code>FL-</code> numbering, equipment fields hidden) or Equipment (→ <code>EQ-</code> numbering, equipment fields shown). Changing it re-derives numbering and field visibility on save.</span>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
            ) : (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                            <tr>
                                <th className="text-left font-bold px-3 py-2.5 w-24">Level / Code</th>
                                <th className="text-left font-bold px-3 py-2.5">Label</th>
                                <th className="text-left font-bold px-3 py-2.5">Object class</th>
                                <th className="text-left font-bold px-3 py-2.5">Num</th>
                                <th className="text-left font-bold px-3 py-2.5">Criticality</th>
                                <th className="text-left font-bold px-3 py-2.5" title="Show equipment taxonomy + spec fields (Category/Class/Manufacturer/Serial) at this level">Equip fields</th>
                                <th className="text-left font-bold px-3 py-2.5">Allowed children</th>
                                <th className="px-3 py-2.5 w-8"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {levels.map((l, idx) => {
                                const isNew = !originalCodes.has(l.code);
                                const childOptions = levels.filter(c => c.code && c.code !== l.code);
                                return (
                                <tr key={idx} className="hover:bg-slate-50 align-top">
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-slate-400">L</span>
                                            <input type="number" min={1} value={l.isoLevel} onChange={e => update(idx, { isoLevel: Number(e.target.value) || 1 })} className="w-11 text-[11px] border border-slate-300 rounded p-1" />
                                        </div>
                                        {isNew ? (
                                            <input value={l.code} onChange={e => update(idx, { code: e.target.value.toUpperCase().replace(/\s/g, '_') })} placeholder="CODE" className="mt-1 w-20 text-[11px] font-mono border border-amber-300 bg-amber-50 rounded p-1 uppercase" />
                                        ) : (
                                            <span className="block mt-1 text-[10px] font-mono font-bold text-slate-500">{l.code}</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <input value={l.label} onChange={e => update(idx, { label: e.target.value })} placeholder="Level name" className="w-36 text-sm border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-primary-500 outline-none" />
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <select value={l.objectClass} onChange={e => { const oc = e.target.value as LevelConfig['objectClass']; update(idx, { objectClass: oc, showEquipmentFields: oc === 'EQUIPMENT' }); }} className="text-sm border border-slate-300 rounded-md p-1.5 bg-white">
                                            <option value="FLOC">Functional Location</option>
                                            <option value="EQUIPMENT">Equipment</option>
                                        </select>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${l.objectClass === 'EQUIPMENT' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {l.objectClass === 'EQUIPMENT' ? 'EQ-' : 'FL-'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <select value={l.criticality} onChange={e => update(idx, { criticality: e.target.value as LevelConfig['criticality'] })} className="text-sm border border-slate-300 rounded-md p-1.5 bg-white">
                                            <option value="optional">Optional</option>
                                            <option value="mandatory">Mandatory</option>
                                        </select>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <input
                                            type="checkbox"
                                            checked={!!l.showEquipmentFields}
                                            onChange={e => update(idx, { showEquipmentFields: e.target.checked })}
                                            className="rounded text-primary-600"
                                            title="Show Category/Class/Manufacturer/Serial fields at this level"
                                        />
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex flex-wrap gap-1 max-w-[230px]">
                                            {childOptions.length === 0 && <span className="text-[10px] text-slate-300">—</span>}
                                            {childOptions.map(c => {
                                                const on = l.allowedChildCodes.includes(c.code);
                                                return (
                                                    <button key={c.code} type="button" onClick={() => toggleChild(idx, c.code)} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition ${on ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                                                        {c.code}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <button type="button" onClick={() => removeLevel(idx)} className="text-slate-300 hover:text-red-500 transition" title="Remove level"><Trash2 size={14} /></button>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="p-3 border-t border-slate-100">
                        <button onClick={addLevel} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-primary-600 border border-dashed border-primary-300 hover:bg-primary-50">
                            <Plus size={15} /> Add Level
                        </button>
                    </div>
                </div>
            )}

            <p className="text-[11px] text-slate-400">
                Changes apply on save (and on next load for everyone). Toggle the chips to set which child levels each level may contain. New level codes are stored as the asset hierarchy level — keep them short and uppercase.
            </p>

            <NumberRangesCard />
            <PerCompanyNumberingCard />
        </div>
    );
};

// ── Per-company number-range overrides (W-2 T-2) ─────────────────────────────
// A sub-company can issue its own equipment / FLOC numbers (Company 1000 →
// EQ-10xxxx). Blank = uses the client default above. Degrades gracefully
// before migration 0174 (no companies / overrides table absent → hint).
const PerCompanyNumberingCard: React.FC = () => {
    const { showToast } = useToast();
    const [companies, setCompanies] = useState<{ id: string; code: string; name: string }[]>([]);
    const [companyId, setCompanyId] = useState('');
    const [eq, setEq] = useState<{ prefix: string; pad: number; next: number } | null>(null);
    const [fl, setFl] = useState<{ prefix: string; pad: number; next: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [ready, setReady] = useState(true); // 0174 applied?

    const loadOverrides = async (cid: string) => {
        const all = await DatabaseService.getInstance().getNumberingOverrides();
        const e = all.find(o => o.companyId === cid && o.objectClass === 'EQUIPMENT');
        const f = all.find(o => o.companyId === cid && o.objectClass === 'FLOC');
        setEq(e ? { prefix: e.prefix, pad: e.pad, next: e.nextNumber } : null);
        setFl(f ? { prefix: f.prefix, pad: f.pad, next: f.nextNumber } : null);
    };

    useEffect(() => {
        const db = DatabaseService.getInstance();
        Promise.all([db.getCompanies(true), db.orgNumberingReady()])
            .then(async ([cs, isReady]) => {
                setReady(isReady);
                const list = cs.map(c => ({ id: c.id, code: c.code, name: c.name }));
                setCompanies(list);
                if (isReady && list.length) { setCompanyId(list[0].id); await loadOverrides(list[0].id); }
            })
            .finally(() => setLoading(false));
    }, []);

    const onPickCompany = async (cid: string) => { setCompanyId(cid); await loadOverrides(cid); };

    const saveOne = async (objectClass: 'EQUIPMENT' | 'FLOC', v: { prefix: string; pad: number; next: number } | null) => {
        if (!companyId || !v || !v.prefix.trim()) { showToast('Enter a prefix to set an override.', 'warning'); return; }
        setSaving(true);
        try {
            await DatabaseService.getInstance().saveNumberingOverride({
                companyId, objectClass, prefix: v.prefix.trim(), pad: Number(v.pad) || 6, nextNumber: Number(v.next) || 1,
            });
            showToast(`${objectClass === 'EQUIPMENT' ? 'Equipment' : 'Functional Location'} range set for this company.`, 'success');
        } catch (e: any) { showToast('Save failed: ' + (e?.message || 'unknown'), 'error'); }
        finally { setSaving(false); }
    };

    const clearOne = async (objectClass: 'EQUIPMENT' | 'FLOC') => {
        setSaving(true);
        try {
            await DatabaseService.getInstance().deleteNumberingOverride(companyId, objectClass);
            if (objectClass === 'EQUIPMENT') setEq(null); else setFl(null);
            showToast('Reverted to the client default.', 'success');
        } catch (e: any) { showToast('Clear failed: ' + (e?.message || 'unknown'), 'error'); }
        finally { setSaving(false); }
    };

    const editor = (
        label: string, color: string,
        v: { prefix: string; pad: number; next: number } | null,
        setV: (x: { prefix: string; pad: number; next: number } | null) => void,
        objectClass: 'EQUIPMENT' | 'FLOC',
        defaultPrefix: string,
    ) => {
        const val = v || { prefix: '', pad: 6, next: 1 };
        const on = !!v;
        return (
            <div className="flex-1 min-w-[240px] rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className={`text-xs font-bold uppercase tracking-wide ${color}`}>{label}</h4>
                    <span className="text-[10px] text-slate-400">{on ? 'override' : `default (${defaultPrefix})`}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">Prefix</label>
                        <input value={val.prefix} onChange={e => setV({ ...val, prefix: e.target.value })} placeholder={defaultPrefix} className="w-full text-sm border border-slate-300 rounded-md p-1.5 font-mono" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">Digits</label>
                        <input type="number" min={1} max={12} value={val.pad} onChange={e => setV({ ...val, pad: Number(e.target.value) })} className="w-full text-sm border border-slate-300 rounded-md p-1.5" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-1">Start at</label>
                        <input type="number" min={1} value={val.next} onChange={e => setV({ ...val, next: Number(e.target.value) })} className="w-full text-sm border border-slate-300 rounded-md p-1.5" />
                    </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Next: <span className="font-mono font-bold text-slate-600">{(val.prefix || defaultPrefix)}{String(val.next || 1).padStart(Number(val.pad) || 0, '0')}</span></span>
                    <div className="flex gap-1.5">
                        {on && <button onClick={() => clearOne(objectClass)} disabled={saving} className="text-[11px] font-semibold text-slate-500 hover:text-red-600 px-2 py-1">Clear</button>}
                        <button onClick={() => saveOne(objectClass, val)} disabled={saving} className="text-[11px] font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-2.5 py-1 rounded-md">Set</button>
                    </div>
                </div>
            </div>
        );
    };

    if (loading) return null;
    if (!ready || companies.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Hash size={17} className="text-primary-600" /> Per-company Number Ranges</h2>
                <p className="text-xs text-slate-500 mt-1">
                    {!ready
                        ? <>Apply migration <code className="font-mono bg-slate-100 px-1 rounded">0174_org_keyed_numbering.sql</code> to enable per-company number ranges (SAP NRIV per Company Code).</>
                        : <>Define a company under <strong>Admin → Companies</strong> to give each sub-company its own numbering framework.</>}
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Hash size={17} className="text-primary-600" /> Per-company Number Ranges</h2>
                <select value={companyId} onChange={e => onPickCompany(e.target.value)} className="text-sm border border-slate-300 rounded-md p-1.5 max-w-[240px]">
                    {companies.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
            </div>
            <p className="text-xs text-slate-500 mb-4">Override the client default for a sub-company (SAP number range per Company Code). Leave blank to use the default above. Applies to assets assigned to this company.</p>
            <div className="flex flex-wrap gap-4">
                {editor('Functional Location', 'text-emerald-600', fl, setFl, 'FLOC', 'FL-')}
                {editor('Equipment', 'text-blue-600', eq, setEq, 'EQUIPMENT', 'EQ-')}
            </div>
        </div>
    );
};

// ── Number ranges (SAP NRIV) ─────────────────────────────────────────────────
const NumberRangesCard: React.FC = () => {
    const { showToast } = useToast();
    const [cfg, setCfg] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        DatabaseService.getInstance().getNumberingConfig()
            .then(c => setCfg(c || { floc_prefix: 'FL-', floc_pad: 6, floc_next: 1, equip_prefix: 'EQ-', equip_pad: 6, equip_next: 1, auto_number_untagged: true }))
            .finally(() => setLoading(false));
    }, []);

    const set = (k: string, v: any) => setCfg((p: any) => ({ ...p, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            await DatabaseService.getInstance().saveNumberingConfig({
                floc_prefix: cfg.floc_prefix, floc_pad: Number(cfg.floc_pad) || 0, floc_next: Number(cfg.floc_next) || 1,
                equip_prefix: cfg.equip_prefix, equip_pad: Number(cfg.equip_pad) || 0, equip_next: Number(cfg.equip_next) || 1,
                auto_number_untagged: !!cfg.auto_number_untagged,
            });
            showToast('Number ranges saved.', 'success');
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally { setSaving(false); }
    };

    const preview = (prefix: string, pad: number, next: number) => `${prefix || ''}${String(next || 1).padStart(Number(pad) || 0, '0')}`;

    const rangeEditor = (title: string, color: string, pk: string, padk: string, nextk: string) => (
        <div className="flex-1 min-w-[220px] rounded-lg border border-slate-200 p-4">
            <h4 className={`text-xs font-bold uppercase tracking-wide mb-3 ${color}`}>{title}</h4>
            <div className="grid grid-cols-3 gap-2">
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">Prefix</label>
                    <input value={cfg[pk] ?? ''} onChange={e => set(pk, e.target.value)} className="w-full text-sm border border-slate-300 rounded-md p-1.5 font-mono" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">Digits</label>
                    <input type="number" min={0} max={12} value={cfg[padk] ?? 6} onChange={e => set(padk, e.target.value)} className="w-full text-sm border border-slate-300 rounded-md p-1.5" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">Start at</label>
                    <input type="number" min={1} value={cfg[nextk] ?? 1} onChange={e => set(nextk, e.target.value)} className="w-full text-sm border border-slate-300 rounded-md p-1.5" />
                </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">Next: <span className="font-mono font-bold text-slate-600">{preview(cfg[pk], cfg[padk], cfg[nextk])}</span></div>
        </div>
    );

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Hash size={17} className="text-primary-600" /> Number Ranges</h2>
                <button onClick={save} disabled={saving || !cfg} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save ranges
                </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">Auto-generated identifiers. "Start at" sets the next number issued — set it above your existing numbers to begin a new range.</p>
            {loading || !cfg ? (
                <div className="flex justify-center py-8 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
            ) : (
                <>
                    <div className="flex flex-wrap gap-4">
                        {rangeEditor('Functional Location', 'text-emerald-600', 'floc_prefix', 'floc_pad', 'floc_next')}
                        {rangeEditor('Equipment', 'text-blue-600', 'equip_prefix', 'equip_pad', 'equip_next')}
                    </div>
                    <label className="flex items-center gap-2 mt-4 cursor-pointer">
                        <input type="checkbox" checked={!!cfg.auto_number_untagged} onChange={e => set('auto_number_untagged', e.target.checked)} className="rounded text-primary-600" />
                        <span className="text-sm text-slate-700">Auto-generate a number for records left without a tag</span>
                    </label>
                </>
            )}
        </div>
    );
};

export default HierarchyConfigPage;
