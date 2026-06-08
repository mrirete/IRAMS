
import React, { useState, useEffect } from 'react';
import { X, Search, Check, User } from 'lucide-react';
import { Contact, OrganizationUnit } from '../../types';
import { DatabaseService } from '../../services/DatabaseService';

interface AddMemberModalProps {
    unit: OrganizationUnit;
    onClose: () => void;
    onSave: () => void;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({ unit, onClose, onSave }) => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadPotentials();
    }, []);

    const loadPotentials = async () => {
        setLoading(true);
        // ideally fetch only unassigned or all, frontend filter
        const all = await DatabaseService.getInstance().getContacts();
        // Filter out those already in THIS unit (optional: allow moving from others)
        // For now, show everyone except those already in this unit so we don't double add visual logic
        // But actually moving from another unit is a valid use case.
        // So just show everyone not in THIS unit.
        setContacts(all.filter(c => c.organizationUnitId !== unit.id && !c.types.includes('VENDOR')));
        setLoading(false);
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            await DatabaseService.getInstance().assignContactsToUnit(Array.from(selectedIds), unit.id);
            onSave();
            onClose();
        } catch (e) {
            console.error(e);
            alert("Failed to assign members");
        } finally {
            setLoading(false);
        }
    };

    const filtered = contacts.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.title?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h3 className="font-bold text-slate-900">Add Members</h3>
                        <p className="text-xs text-slate-500">Assign to {unit.name}</p>
                    </div>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>

                <div className="p-4 border-b border-slate-100">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            className="w-full pl-9 p-2 border border-slate-300 rounded-md text-sm"
                            placeholder="Search people..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {loading ? (
                        <div className="text-center py-8 text-slate-400">Loading...</div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">No available contacts found.</div>
                    ) : (
                        filtered.map(c => (
                            <div
                                key={c.id}
                                onClick={() => toggleSelection(c.id)}
                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${selectedIds.has(c.id) ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
                            >
                                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${selectedIds.has(c.id) ? 'bg-relantern-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                    {selectedIds.has(c.id) ? <Check size={14} /> : (c.firstName?.[0] || c.name[0])}
                                </div>
                                <div className="flex-1">
                                    <div className={`text-sm font-medium ${selectedIds.has(c.id) ? 'text-blue-900' : 'text-slate-900'}`}>{c.name}</div>
                                    <div className="text-xs text-slate-500">{c.title} {c.organizationUnitId ? '(Reassign)' : ''}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                    <span className="text-xs text-slate-500">{selectedIds.size} selected</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded text-sm font-medium">Cancel</button>
                        <button
                            disabled={selectedIds.size === 0 || loading}
                            onClick={handleSave}
                            className="px-4 py-1.5 bg-relantern-500 text-white rounded text-sm font-medium hover:bg-relantern-600 disabled:opacity-50"
                        >
                            {loading ? 'Saving...' : 'Add Selected'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
