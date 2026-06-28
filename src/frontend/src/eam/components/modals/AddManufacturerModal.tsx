import React, { useState } from 'react';
import { X, Factory } from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';

interface AddManufacturerModalProps {
    onClose: () => void;
    onSave: (manufacturer: any) => void; // the created master record
    initialName?: string;
}

/**
 * Dedicated Manufacturer master form (UAT F-003 follow-up). Writes to the
 * manufacturers master via the manufacturer API — NOT the People/contact form.
 */
export const AddManufacturerModal: React.FC<AddManufacturerModalProps> = ({ onClose, onSave, initialName }) => {
    const [form, setForm] = useState({ name: initialName || '', country: '', website: '', phone: '', email: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) { setError('Manufacturer name is required.'); return; }
        setSaving(true); setError(null);
        try {
            const created = await DatabaseService.getInstance().addManufacturer(form);
            onSave(created);
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Could not save manufacturer.');
        } finally {
            setSaving(false);
        }
    };

    const field = (label: string, key: keyof typeof form, placeholder = '', type = 'text') => (
        <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
            <input
                type={type}
                className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-primary-500 outline-none"
                value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
            />
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Factory size={18} className="text-blue-600" /> Add New Manufacturer</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                <form onSubmit={submit} className="p-6 overflow-y-auto space-y-4">
                    {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Manufacturer Name <span className="text-red-500">*</span></label>
                        <input
                            required autoFocus
                            className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder="e.g. Siemens, GE, ABB"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {field('Country of Origin', 'country', 'e.g. Germany')}
                        {field('Phone', 'phone', 'Contact number')}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        {field('Website', 'website', 'https://…')}
                        {field('Contact Email', 'email', 'sales@manufacturer.com', 'email')}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                        <textarea
                            className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-primary-500 outline-none"
                            rows={2}
                            value={form.notes}
                            onChange={e => setForm({ ...form, notes: e.target.value })}
                            placeholder="Optional"
                        />
                    </div>

                    <div className="pt-2 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
                        <button type="submit" disabled={saving} className="px-6 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm disabled:opacity-50">
                            {saving ? 'Saving…' : 'Create Manufacturer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
