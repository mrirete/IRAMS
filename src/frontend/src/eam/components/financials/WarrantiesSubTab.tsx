import React, { useState } from 'react';
import { FileCheck, Plus, Edit3, Trash2, X, Save } from 'lucide-react';
import { Warranty } from '../../services/FinOpsService';
import { AddWarrantyModal } from '../modals/AddWarrantyModal';

interface WarrantiesProps {
    warranties: Warranty[];
    saving: boolean;
    onAddWarranty: (data: Partial<Warranty>) => void;
    onDeleteWarranty: (id: string, type: string) => void;
    onUpdateWarranty: (id: string, data: Partial<Warranty>) => void;
}

export const WarrantiesSubTab: React.FC<WarrantiesProps> = ({
    warranties, saving, onAddWarranty, onDeleteWarranty, onUpdateWarranty
}) => {
    const [showAddModal, setShowAddModal] = useState(false);

    // Inline edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editType, setEditType] = useState('');
    const [editScope, setEditScope] = useState('');
    const [editStartDate, setEditStartDate] = useState('');
    const [editEndDate, setEditEndDate] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [editMaxHours, setEditMaxHours] = useState<number | undefined>(undefined);

    const startEdit = (w: Warranty) => {
        setEditingId(w.id);
        setEditType(w.warrantyType);
        setEditScope(w.coverageScope || '');
        setEditStartDate(w.startDate || '');
        setEditEndDate(w.endDate || '');
        setEditStatus(w.status);
        setEditMaxHours(w.maxHours);
    };

    const handleSave = () => {
        if (!editingId) return;
        onUpdateWarranty(editingId, {
            warrantyType: editType as Warranty['warrantyType'],
            coverageScope: editScope,
            startDate: editStartDate,
            endDate: editEndDate,
            status: editStatus as Warranty['status'],
            maxHours: editMaxHours
        });
        setEditingId(null);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <FileCheck size={16} className="text-slate-400" />
                        Warranties
                    </h3>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="text-xs bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg flex items-center gap-1 font-medium transition"
                    >
                        <Plus size={12} /> Add Warranty
                    </button>
                </div>

                {warranties.length === 0 ? (
                    <div className="p-10 text-center">
                        <FileCheck size={28} className="mx-auto mb-2 text-slate-300" />
                        <div className="text-sm text-slate-400 italic">No warranties recorded.</div>
                        <div className="text-xs text-slate-400 mt-1">Add an OEM or extended warranty to track coverage.</div>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {warranties.map(w => (
                            <div key={w.id} className="p-4 hover:bg-slate-50/50 transition">
                                {editingId === w.id ? (
                                    /* Inline Edit Form */
                                    <div className="space-y-3 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Type</label>
                                                <select value={editType} onChange={e => setEditType(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white">
                                                    <option value="OEM">OEM</option>
                                                    <option value="EXTENDED">Extended</option>
                                                    <option value="SERVICE_CONTRACT">Service Contract</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Status</label>
                                                <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white">
                                                    <option value="ACTIVE">Active</option>
                                                    <option value="EXPIRED">Expired</option>
                                                    <option value="VOIDED">Voided</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase">Coverage Scope</label>
                                            <input type="text" value={editScope} onChange={e => setEditScope(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" placeholder="e.g. Full mechanical coverage" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Start Date</label>
                                                <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">End Date</label>
                                                <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-500 uppercase">Max Hours</label>
                                            <input type="number" value={editMaxHours || ''} onChange={e => setEditMaxHours(e.target.value ? parseInt(e.target.value) : undefined)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" placeholder="Optional" />
                                        </div>
                                        <div className="flex justify-end gap-2 pt-1">
                                            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded flex items-center gap-1">
                                                <X size={12} /> Cancel
                                            </button>
                                            <button onClick={handleSave} disabled={saving} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1 disabled:opacity-50">
                                                <Save size={12} /> {saving ? '...' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* Display Mode */
                                    <>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-medium text-slate-800 text-sm">{w.warrantyType}</span>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => startEdit(w)} className="text-xs text-blue-400 hover:text-blue-600 p-0.5" title="Edit warranty">
                                                    <Edit3 size={13} />
                                                </button>
                                                <button onClick={() => onDeleteWarranty(w.id, w.warrantyType)} className="text-xs text-red-400 hover:text-red-600 p-0.5" title={`Delete ${w.warrantyType} warranty`}>
                                                    <Trash2 size={13} />
                                                </button>
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${
                                                    w.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                                                    w.status === 'EXPIRED' ? 'bg-red-100 text-red-600' :
                                                    'bg-slate-100 text-slate-600'
                                                }`}>{w.status}</span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {w.coverageScope && <div className="mb-0.5">{w.coverageScope}</div>}
                                            <div className="flex gap-3">
                                                <span>Start: {w.startDate ? new Date(w.startDate).toLocaleDateString() : 'N/A'}</span>
                                                <span>Expires: {w.endDate ? new Date(w.endDate).toLocaleDateString() : 'N/A'}</span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <AddWarrantyModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSave={(data) => { onAddWarranty(data); setShowAddModal(false); }}
            />
        </div>
    );
};
