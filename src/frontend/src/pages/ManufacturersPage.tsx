/**
 * ManufacturersPage — master-data management for the manufacturer master
 * (UAT F-003 follow-up). List / edit manufacturers and manage their models in one
 * place, all keyed by manufacturer_id. The Asset "+ Manufacturer" still adds here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Factory, Plus, Search, Save, Trash2, Loader2, Package, Globe, Phone, Mail, MapPin } from 'lucide-react';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useToast } from '../eam/contexts/ToastContext';
import { AddManufacturerModal } from '../eam/components/modals/AddManufacturerModal';

interface Manufacturer { id: string; name: string; country?: string; website?: string; phone?: string; email?: string; notes?: string }
interface Model { id: string; code: string; description?: string; active?: boolean }

export const ManufacturersPage: React.FC = () => {
    const [mfrs, setMfrs] = useState<Manufacturer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);

    const load = () => {
        setLoading(true);
        DatabaseService.getInstance().getManufacturers().then(setMfrs).finally(() => setLoading(false));
    };
    useEffect(load, []);

    const filtered = useMemo(
        () => mfrs.filter(m => m.name.toLowerCase().includes(search.toLowerCase())),
        [mfrs, search]
    );
    const selected = mfrs.find(m => m.id === selectedId) || null;

    return (
        <div className="max-w-6xl mx-auto">
            {showAdd && (
                <AddManufacturerModal
                    onClose={() => setShowAdd(false)}
                    onSave={(m) => { load(); setSelectedId(m.id); }}
                />
            )}

            <div className="flex items-center justify-between mb-4">
                <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                    <Factory size={20} className="text-primary-600" /> Manufacturers
                    <span className="text-xs font-normal text-slate-400">{mfrs.length} in master</span>
                </h1>
                <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 shadow-sm">
                    <Plus size={15} /> Add Manufacturer
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4">
                {/* List */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="p-2.5 border-b border-slate-100">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search manufacturers..."
                                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:ring-1 focus:ring-primary-500 outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[60vh]">
                        {loading ? (
                            <div className="flex justify-center py-10 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
                        ) : filtered.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-10">No manufacturers</p>
                        ) : filtered.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedId(m.id)}
                                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 transition ${selectedId === m.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'}`}
                            >
                                <div className="text-sm font-semibold text-slate-800 truncate">{m.name}</div>
                                {m.country && <div className="text-[11px] text-slate-400 flex items-center gap-1"><MapPin size={9} /> {m.country}</div>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Detail */}
                <div>
                    {selected ? (
                        <ManufacturerDetail key={selected.id} manufacturer={selected} onSaved={load} onDeleted={() => { setSelectedId(null); load(); }} />
                    ) : (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-slate-400 text-sm">
                            Select a manufacturer to edit its details and models.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── Detail + models manager ──────────────────────────────────────────────────
const ManufacturerDetail: React.FC<{ manufacturer: Manufacturer; onSaved: () => void; onDeleted: () => void }> = ({ manufacturer, onSaved, onDeleted }) => {
    const { showToast } = useToast();
    const [form, setForm] = useState<Manufacturer>(manufacturer);
    const [saving, setSaving] = useState(false);
    const [models, setModels] = useState<Model[]>([]);
    const [newModel, setNewModel] = useState({ code: '', description: '' });

    useEffect(() => {
        setForm(manufacturer);
        DatabaseService.getInstance().getManufacturerModels(manufacturer.id).then(setModels).catch(() => setModels([]));
    }, [manufacturer]);

    const save = async () => {
        if (!form.name.trim()) { showToast('Name is required.', 'error'); return; }
        setSaving(true);
        try {
            await DatabaseService.getInstance().updateManufacturer(manufacturer.id, {
                name: form.name.trim(), country: form.country || null, website: form.website || null,
                phone: form.phone || null, email: form.email || null, notes: form.notes || null,
            });
            showToast('Manufacturer saved.', 'success');
            onSaved();
        } catch (e: any) {
            showToast('Save failed: ' + (e?.message || 'unknown'), 'error');
        } finally { setSaving(false); }
    };

    const addModel = async () => {
        if (!newModel.code.trim()) return;
        try {
            const created = await DatabaseService.getInstance().addManufacturerModel(manufacturer.id, { code: newModel.code.trim(), description: newModel.description });
            setModels(prev => [...prev, { id: created.id, code: newModel.code.trim(), description: newModel.description, active: true }]);
            setNewModel({ code: '', description: '' });
        } catch (e: any) {
            showToast('Could not add model: ' + (e?.message || 'unknown'), 'error');
        }
    };

    const deleteModel = async (id: string) => {
        try {
            await DatabaseService.getInstance().deleteManufacturerModel(id);
            setModels(prev => prev.filter(m => m.id !== id));
        } catch (e: any) {
            showToast('Could not delete model.', 'error');
        }
    };

    const field = (label: string, key: keyof Manufacturer, icon: React.ReactNode, type = 'text') => (
        <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1">{icon} {label}</label>
            <input
                type={type}
                value={(form[key] as string) || ''}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
                className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-1 focus:ring-primary-500 outline-none"
            />
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-slate-800">{manufacturer.name}</h2>
                    <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                    </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Manufacturer Name</label>
                        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-1 focus:ring-primary-500 outline-none" />
                    </div>
                    {field('Country of Origin', 'country', <MapPin size={10} />)}
                    {field('Phone', 'phone', <Phone size={10} />)}
                    {field('Website', 'website', <Globe size={10} />)}
                    {field('Contact Email', 'email', <Mail size={10} />, 'email')}
                    <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Notes</label>
                        <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-1 focus:ring-primary-500 outline-none" />
                    </div>
                </div>
            </div>

            {/* Models */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3"><Package size={15} className="text-slate-400" /> Models <span className="text-xs font-normal text-slate-400">{models.length}</span></h3>
                <div className="space-y-1.5 mb-3 max-h-56 overflow-y-auto">
                    {models.length === 0 && <p className="text-xs text-slate-400">No models yet — add one below.</p>}
                    {models.map(m => (
                        <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-slate-50 border border-slate-100">
                            <div className="min-w-0">
                                <span className="text-sm font-mono font-semibold text-slate-700">{m.code}</span>
                                {m.description && <span className="text-xs text-slate-400 ml-2 truncate">{m.description}</span>}
                            </div>
                            <button onClick={() => deleteModel(m.id)} className="text-slate-300 hover:text-red-500 transition shrink-0" title="Delete model"><Trash2 size={14} /></button>
                        </div>
                    ))}
                </div>
                <div className="flex items-end gap-2 pt-3 border-t border-slate-100">
                    <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Model code</label>
                        <input value={newModel.code} onChange={e => setNewModel({ ...newModel, code: e.target.value })} placeholder="e.g. LM2500" className="w-full text-sm border border-slate-300 rounded-md p-2 font-mono focus:ring-1 focus:ring-primary-500 outline-none" />
                    </div>
                    <div className="flex-1">
                        <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Description</label>
                        <input value={newModel.description} onChange={e => setNewModel({ ...newModel, description: e.target.value })} placeholder="Optional" className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-1 focus:ring-primary-500 outline-none" />
                    </div>
                    <button onClick={addModel} disabled={!newModel.code.trim()} className="px-3 py-2 rounded-lg text-sm font-semibold text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-40 shrink-0">Add</button>
                </div>
            </div>
        </div>
    );
};

export default ManufacturersPage;
