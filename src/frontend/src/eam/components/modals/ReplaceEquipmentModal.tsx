import React, { useState } from 'react';
import { X, Repeat, Hash } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ReplaceEquipmentModalProps {
    asset: { id: string; tag: string; name?: string; equipmentNumber?: string; equipmentGeneration?: number; serialNumber?: string };
    onClose: () => void;
    /** Called with the new identity after a successful swap. */
    onReplaced: (result: { equipmentNumber: string; equipmentGeneration: number; serialNumber?: string }) => void;
}

/**
 * Records a physical equipment swap — the SAP install/dismantle moment.
 *
 * The position (tag, hierarchy, work-order history) stays; the object identity
 * moves on: a new equipment number is issued (or supplied, e.g. the spare's
 * SAP EQUNR), the generation increments, and the outgoing unit's identity is
 * archived in asset_replacements. Backed by the replace_equipment() RPC
 * (0293) — the ONLY sanctioned way to change an equipment number, which is
 * otherwise immutable at the DB.
 */
export const ReplaceEquipmentModal: React.FC<ReplaceEquipmentModalProps> = ({ asset, onClose, onReplaced }) => {
    const [form, setForm] = useState({ equipmentNumber: '', serialNumber: '', reason: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true); setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('replace_equipment', {
                p_asset_id: asset.id,
                p_new_equipment_number: form.equipmentNumber.trim() || null,
                p_reason: form.reason.trim() || null,
                p_new_serial_number: form.serialNumber.trim() || null,
            });
            if (rpcError) throw new Error(rpcError.message);
            onReplaced({
                equipmentNumber: data?.equipment_number as string,
                equipmentGeneration: data?.equipment_generation as number,
                serialNumber: form.serialNumber.trim() || undefined,
            });
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Could not record the replacement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Repeat size={18} className="text-blue-600" /> Replace Equipment — {asset.tag}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                <form onSubmit={submit} className="p-6 overflow-y-auto space-y-4">
                    {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>}

                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-slate-700 space-y-1">
                        <div className="flex items-center gap-2 font-mono text-blue-700 font-bold">
                            <Hash size={12} /> {asset.equipmentNumber || '—'}
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 font-semibold">Gen {asset.equipmentGeneration || 1}</span>
                        </div>
                        <p className="text-xs text-slate-500">
                            The position keeps its tag, place in the hierarchy and work-order history.
                            The outgoing unit's number{asset.serialNumber ? ' and serial' : ''} are archived in the replacement log.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">New equipment number</label>
                        <input
                            type="text"
                            className="w-full text-sm border border-slate-300 rounded-md p-2 font-mono focus:ring-2 focus:ring-primary-500 outline-none"
                            value={form.equipmentNumber}
                            onChange={e => setForm({ ...form, equipmentNumber: e.target.value })}
                            placeholder="Leave blank to auto-number"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">Provide the incoming unit's existing id (e.g. its SAP equipment number) or leave blank for the next number in the range.</p>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">New serial number</label>
                        <input
                            type="text"
                            className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={form.serialNumber}
                            onChange={e => setForm({ ...form, serialNumber: e.target.value })}
                            placeholder="Serial of the incoming unit — blank if unknown"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reason</label>
                        <input
                            type="text"
                            className="w-full text-sm border border-slate-300 rounded-md p-2 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={form.reason}
                            onChange={e => setForm({ ...form, reason: e.target.value })}
                            placeholder="e.g. Bearing failure — swapped with warehouse spare"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 flex items-center gap-2">
                            {saving && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                            Record replacement
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
