/**
 * HierarchyConfigPage — Admin editor for the asset hierarchy level model (UAT F-010).
 *
 * Edits the single source of truth (hierarchyModel): per-level label, object class
 * (FLOC vs Equipment — which drives numbering + equipment-field visibility), and the
 * criticality rule. Saves to hierarchy_config and applies live via setLevelModel.
 */
import React, { useEffect, useState } from 'react';
import { Layers, Save, Loader2, RotateCcw, CheckCircle, Info, Hash } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import { getLevels, DEFAULT_LEVELS, setLevelModel, type LevelConfig } from '../eam/services/hierarchyModel';

export const HierarchyConfigPage: React.FC = () => {
    const [levels, setLevels] = useState<LevelConfig[]>(() => getLevels().map(l => ({ ...l })));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        DatabaseService.getInstance().getHierarchyConfig()
            .then(cfg => { if (cfg && cfg.length) setLevels(cfg as LevelConfig[]); })
            .finally(() => setLoading(false));
    }, []);

    const update = (idx: number, patch: Partial<LevelConfig>) => {
        setLevels(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
        setSaved(false);
    };

    // Numbering + field visibility derive from object class so the model stays consistent.
    const normalize = (l: LevelConfig): LevelConfig => ({
        ...l,
        numbering: l.objectClass === 'EQUIPMENT' ? 'EQ' : 'FL',
        showEquipmentFields: l.objectClass === 'EQUIPMENT',
    });

    const handleSave = async () => {
        setSaving(true);
        try {
            const normalized = levels.map(normalize);
            await DatabaseService.getInstance().saveHierarchyConfig(normalized);
            setLevelModel(normalized);
            setLevels(normalized);
            setSaved(true);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = () => { setLevels(DEFAULT_LEVELS.map(l => ({ ...l }))); setSaved(false); };

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
                                <th className="text-left font-bold px-4 py-2.5">Level</th>
                                <th className="text-left font-bold px-4 py-2.5">Label</th>
                                <th className="text-left font-bold px-4 py-2.5">Object class</th>
                                <th className="text-left font-bold px-4 py-2.5">Numbering</th>
                                <th className="text-left font-bold px-4 py-2.5">Criticality</th>
                                <th className="text-left font-bold px-4 py-2.5">Allowed children</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {levels.map((l, idx) => (
                                <tr key={l.code} className="hover:bg-slate-50">
                                    <td className="px-4 py-2.5 whitespace-nowrap">
                                        <span className="font-mono text-[11px] font-bold text-slate-700">L{l.isoLevel}</span>
                                        <span className="ml-1.5 text-[10px] text-slate-400">{l.code}</span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <input
                                            value={l.label}
                                            onChange={e => update(idx, { label: e.target.value })}
                                            className="w-40 text-sm border border-slate-300 rounded-md p-1.5 focus:ring-1 focus:ring-primary-500 outline-none"
                                        />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <select
                                            value={l.objectClass}
                                            onChange={e => update(idx, { objectClass: e.target.value as LevelConfig['objectClass'] })}
                                            className="text-sm border border-slate-300 rounded-md p-1.5 bg-white"
                                        >
                                            <option value="FLOC">Functional Location</option>
                                            <option value="EQUIPMENT">Equipment</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${l.objectClass === 'EQUIPMENT' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {l.objectClass === 'EQUIPMENT' ? 'EQ-' : 'FL-'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <select
                                            value={l.criticality}
                                            onChange={e => update(idx, { criticality: e.target.value as LevelConfig['criticality'] })}
                                            className="text-sm border border-slate-300 rounded-md p-1.5 bg-white"
                                        >
                                            <option value="optional">Optional</option>
                                            <option value="mandatory">Mandatory</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-2.5 text-[11px] text-slate-400">
                                        {l.allowedChildCodes.length ? l.allowedChildCodes.join(', ') : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-[11px] text-slate-400">
                Changes apply immediately on save (and on next load for everyone). Structural rules (allowed children) are seeded from the ISO 14224 model and shown read-only here.
            </p>

            <NumberRangesCard />
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
            <p className="text-xs text-slate-500 mb-4">Auto-generated identifiers (SAP NRIV parity). "Start at" sets the next number issued — set it above your existing numbers to begin a new range.</p>
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
