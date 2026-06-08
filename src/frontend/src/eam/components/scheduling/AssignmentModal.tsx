import React, { useState, useMemo, useRef, useEffect } from 'react';
import { UserPlus, Search, X, User, Award, DollarSign } from 'lucide-react';
import type { Contact } from '../../types';

interface AssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAssign: (contactId: string, contactName: string) => void;
    contacts: Contact[];
    woTitle: string;
    woNumber: string;
    selectedIds: Set<string>;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
    isOpen,
    onClose,
    onAssign,
    contacts,
    woTitle,
    woNumber,
    selectedIds,
}) => {
    const [filter, setFilter] = useState('');
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setFilter('');
            setSelectedContactId(null);
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const filteredContacts = useMemo(() => {
        if (!filter) return contacts;
        const lc = filter.toLowerCase();
        return contacts.filter(
            (c) =>
                c.name.toLowerCase().includes(lc) ||
                c.code.toLowerCase().includes(lc) ||
                c.types.some((t) => t.toLowerCase().includes(lc))
        );
    }, [contacts, filter]);

    const selectedContact = useMemo(
        () => contacts.find((c) => c.id === selectedContactId) ?? null,
        [contacts, selectedContactId]
    );

    const isBulk = selectedIds.size > 1;
    const headerLabel = isBulk
        ? `Assign ${selectedIds.size} Work Orders`
        : `Assign ${woNumber}`;

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!selectedContact) return;
        onAssign(selectedContact.id, selectedContact.name);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden transform transition-all scale-100">
                {/* ── Header ── */}
                <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 p-3 rounded-full bg-blue-100">
                            <UserPlus className="text-blue-600" size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold text-slate-900">{headerLabel}</h3>
                            {!isBulk && (
                                <p className="text-sm text-slate-500 truncate mt-0.5">{woTitle}</p>
                            )}
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-500 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* ── Search ── */}
                    <div className="relative mt-4">
                        <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search by name, code, or craft…"
                            className="w-full text-sm pl-9 pr-9 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white transition"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                        />
                        {filter && (
                            <button
                                onClick={() => setFilter('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <div className="mt-1.5 text-[10px] text-slate-400 font-medium">
                        {filteredContacts.length} technician{filteredContacts.length !== 1 ? 's' : ''}
                        {filter && ` matching "${filter}"`}
                    </div>
                </div>

                {/* ── Contact List ── */}
                <div className="max-h-[320px] overflow-y-auto overscroll-contain">
                    {filteredContacts.length > 0 ? (
                        filteredContacts.map((contact) => {
                            const isSelected = contact.id === selectedContactId;
                            const qualCount = contact.qualifications?.length ?? 0;
                            const craftTypes = contact.types.filter(
                                (t) => t !== 'INTERNAL' && t !== 'LABOUR'
                            );

                            return (
                                <div
                                    key={contact.id}
                                    onClick={() => setSelectedContactId(contact.id)}
                                    className={`
                                        px-6 py-3 cursor-pointer flex items-center gap-3 transition-colors border-b border-slate-50 last:border-0
                                        ${isSelected ? 'bg-blue-50 ring-inset ring-1 ring-blue-200' : 'hover:bg-slate-50'}
                                    `}
                                >
                                    {/* Avatar / Status */}
                                    <div className="relative flex-shrink-0">
                                        <div
                                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                                isSelected
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-slate-100 text-slate-500'
                                            }`}
                                        >
                                            <User size={18} />
                                        </div>
                                        {/* Active dot */}
                                        <span
                                            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                                contact.active ? 'bg-green-500' : 'bg-slate-300'
                                            }`}
                                        />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`text-sm font-medium truncate ${
                                                    isSelected ? 'text-blue-800' : 'text-slate-800'
                                                }`}
                                            >
                                                {contact.name}
                                            </span>
                                            {!contact.active && (
                                                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                                    INACTIVE
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-0.5">
                                            <span className="text-[11px] text-slate-400 font-mono">
                                                {contact.code}
                                            </span>
                                            {craftTypes.length > 0 && (
                                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                    {craftTypes.join(' · ')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Right badges */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {qualCount > 0 && (
                                            <span
                                                className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"
                                                title={`${qualCount} qualification${qualCount !== 1 ? 's' : ''}`}
                                            >
                                                <Award size={10} />
                                                {qualCount}
                                            </span>
                                        )}
                                        {contact.hourlyRate != null && contact.hourlyRate > 0 && (
                                            <span
                                                className="flex items-center gap-0.5 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded"
                                                title="Hourly rate"
                                            >
                                                <DollarSign size={10} />
                                                {contact.hourlyRate.toFixed(0)}/hr
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="px-4 py-10 text-center">
                            <Search size={24} className="mx-auto mb-2 text-slate-300" />
                            <div className="text-sm text-slate-400">No technicians found</div>
                            <div className="text-xs text-slate-300 mt-1">
                                Try a different search term
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="bg-slate-50 px-6 py-4 flex items-center justify-between border-t border-slate-100">
                    <div className="text-xs text-slate-400 truncate max-w-[200px]">
                        {selectedContact
                            ? `Selected: ${selectedContact.name}`
                            : 'Select a technician above'}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!selectedContact}
                            className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2 ${
                                selectedContact
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            <UserPlus size={14} />
                            {selectedContact
                                ? `Assign to ${selectedContact.name.split(' ')[0]}`
                                : 'Assign'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
