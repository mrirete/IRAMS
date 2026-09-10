/**
 * New study — asks the one question that makes everything after it specific:
 * what decision is this study for?
 *
 * The objective picks the study's steps (see studyObjectives.ts), so a spares
 * study never asks for a block diagram and an interval study is not left
 * staring at five equal calculators. It also sets what the study is expected
 * to hand over, which is what the register later shows as its outcome.
 */
import React, { useEffect, useState } from 'react';
import { X, Check, Search } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { OBJECTIVES, type StudyObjective } from './studyObjectives';

interface AssetOption { id: string; tag: string; name: string; criticality?: string }

interface Props {
    open: boolean;
    onClose: () => void;
    onCreate: (input: {
        name: string;
        description: string;
        objective: StudyObjective;
        asset: AssetOption | null;
    }) => Promise<boolean>;
    /** Pre-selected asset (e.g. started from the Start here shortlist). */
    initialAsset?: AssetOption | null;
}

export const NewStudyModal: React.FC<Props> = ({ open, onClose, onCreate, initialAsset }) => {
    const [objective, setObjective] = useState<StudyObjective>('interval');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [asset, setAsset] = useState<AssetOption | null>(null);
    const [assets, setAssets] = useState<AssetOption[]>([]);
    const [query, setQuery] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setObjective('interval');
        setDescription('');
        setAsset(initialAsset ?? null);
        setQuery('');
        setPickerOpen(false);
    }, [open, initialAsset]);

    useEffect(() => {
        if (!open || assets.length > 0) return;
        supabase.from('assets').select('id, tag, name, criticality').order('name').limit(400)
            .then(({ data }) => setAssets((data || []) as AssetOption[]));
    }, [open, assets.length]);

    // Suggest a name from the objective + asset so nobody has to invent one.
    useEffect(() => {
        if (!open) return;
        const def = OBJECTIVES.find(o => o.id === objective);
        const subject = asset ? `${asset.tag}` : 'Fleet';
        setName(`${subject} — ${def?.label ?? 'Study'} — ${new Date().toLocaleDateString()}`);
    }, [open, objective, asset]);

    if (!open) return null;

    const filtered = query
        ? assets.filter(a => (a.name || '').toLowerCase().includes(query.toLowerCase()) || (a.tag || '').toLowerCase().includes(query.toLowerCase()))
        : assets;

    const submit = async () => {
        if (!name.trim()) return;
        setSaving(true);
        const ok = await onCreate({ name: name.trim(), description: description.trim(), objective, asset });
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">New study</h3>
                        <p className="text-xs text-slate-400 mt-0.5">A study is for one decision — the decision picks the tools.</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg shrink-0"><X size={18} /></button>
                </div>

                <div className="px-6 py-5 space-y-5 overflow-y-auto">
                    {/* 1. The decision */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">What is this study for?</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {OBJECTIVES.map(o => {
                                const active = objective === o.id;
                                return (
                                    <button
                                        key={o.id}
                                        onClick={() => setObjective(o.id)}
                                        className={`text-left p-3 rounded-xl border transition-all ${active
                                            ? 'border-primary-400 bg-primary-50/60 ring-2 ring-primary-200'
                                            : 'border-slate-200 bg-white hover:border-primary-300'}`}
                                    >
                                        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                                            {active && <Check size={13} className="text-primary-600 shrink-0" />}
                                            {o.label}
                                        </span>
                                        <span className="block text-[11px] text-slate-500 mt-1 leading-snug">{o.question}</span>
                                        <span className="block text-[10px] font-semibold text-emerald-600 mt-1.5">→ {o.delivers}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Asset */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Asset <span className="font-normal text-slate-400 normal-case">(optional — a fleet or class study can leave this blank)</span></label>
                        <div className="relative">
                            <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white cursor-pointer" onClick={() => setPickerOpen(o => !o)}>
                                <Search size={14} className="text-slate-400" />
                                <input
                                    type="text"
                                    value={pickerOpen ? query : asset ? `${asset.name} (${asset.tag})` : ''}
                                    onChange={e => { setQuery(e.target.value); setPickerOpen(true); }}
                                    onFocus={() => setPickerOpen(true)}
                                    placeholder="Search asset by name or tag…"
                                    className="w-full text-sm outline-none bg-transparent"
                                />
                                {asset && (
                                    <button onClick={e => { e.stopPropagation(); setAsset(null); setQuery(''); }} className="text-slate-400 hover:text-red-500 text-sm">✕</button>
                                )}
                            </div>
                            {pickerOpen && (
                                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                    {filtered.slice(0, 20).map(a => (
                                        <button
                                            key={a.id}
                                            onClick={() => { setAsset(a); setPickerOpen(false); setQuery(''); }}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-primary-50 flex justify-between gap-2"
                                        >
                                            <span className="truncate">{a.name}</span>
                                            <span className="text-xs text-slate-400 font-mono shrink-0">{a.tag}</span>
                                        </button>
                                    ))}
                                    {filtered.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No assets found</p>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. Name + scope note */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Study name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Scope / context <span className="font-normal text-slate-400 normal-case">(optional)</span></label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={2}
                            placeholder="Why now? What triggered it — a breakdown, a budget review, an audit finding…"
                            className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button
                        onClick={submit}
                        disabled={saving || !name.trim()}
                        className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 rounded-lg shadow-md hover:bg-primary-700 transition-all disabled:opacity-50"
                    >
                        {saving ? 'Creating…' : 'Create study'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NewStudyModal;
