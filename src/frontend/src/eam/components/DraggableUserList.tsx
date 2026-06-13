
import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../services/DatabaseService';
import { Contact, OrganizationUnit } from '../types';
import { Search, GripVertical, Loader, Building2 } from 'lucide-react';

interface DraggableUserListProps {
    isOpen: boolean;
    onClose: () => void;
    refreshKey?: number;
    onSelectContact?: (contact: Contact) => void;
}

export const DraggableUserList: React.FC<DraggableUserListProps> = ({ isOpen, onClose, refreshKey, onSelectContact }) => {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [orgUnits, setOrgUnits] = useState<OrganizationUnit[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        const loadData = async () => {
            setLoading(true);
            try {
                const db = DatabaseService.getInstance();
                const [allContacts, allUnits] = await Promise.all([
                    db.getContacts(),
                    db.getOrgUnits()
                ]);
                setContacts(allContacts);
                setOrgUnits(allUnits);
            } catch (error) {
                console.error("Failed to load contacts for DnD", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [isOpen, refreshKey]);

    const filteredContacts = contacts.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.code?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort: unassigned first so they're easy to find for drag
    const sortedContacts = [...filteredContacts].sort((a, b) => {
        const aAssigned = a.organizationUnitId ? 1 : 0;
        const bAssigned = b.organizationUnitId ? 1 : 0;
        return aAssigned - bAssigned;
    });

    const getUnitName = (unitId?: string | null) => {
        if (!unitId) return null;
        return orgUnits.find(u => u.id === unitId)?.name || null;
    };

    const handleDragStart = (e: React.DragEvent, contact: Contact) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            contactId: contact.id,
            name: contact.name,
            type: 'CONTACT'
        }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    if (!isOpen) return null;

    return (
        <div className="fixed right-0 top-0 h-full w-80 bg-white dark:bg-gray-800 shadow-2xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700 transition-transform duration-300">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-blue-600 text-white">
                <h3 className="font-semibold text-lg">People</h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium bg-blue-500 px-2 py-0.5 rounded-full">{contacts.length}</span>
                    <button onClick={onClose} className="hover:bg-blue-700 p-1 rounded">
                        ✕
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="p-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                    <input
                        type="text"
                        placeholder="Search people..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    Drag people onto an org unit to assign them.
                </p>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {loading ? (
                    <div className="flex justify-center items-center h-20">
                        <Loader className="animate-spin h-6 w-6 text-blue-500" />
                    </div>
                ) : (
                    sortedContacts.map(contact => {
                        const unitName = getUnitName(contact.organizationUnitId);
                        const role = contact.defaultType || contact.types?.[0];
                        return (
                            <div
                                key={contact.id}
                                draggable={!onSelectContact}
                                onDragStart={(e) => handleDragStart(e, contact)}
                                onClick={() => onSelectContact?.(contact)}
                                className={`flex items-center p-3 bg-white dark:bg-gray-700 rounded-lg shadow-sm border border-gray-100 dark:border-gray-600 hover:shadow-md active:cursor-grabbing hover:border-blue-300 transition-all group ${onSelectContact ? 'cursor-pointer' : 'cursor-grab'
                                    }`}
                            >
                                <GripVertical className="h-4 w-4 text-gray-400 mr-2 opacity-50 group-hover:opacity-100" />
                                <div className="relative">
                                    <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs mr-3">
                                        {contact.firstName?.[0]}{contact.lastName?.[0]}
                                    </div>
                                    {/* Assignment indicator dot */}
                                    <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${unitName ? 'bg-green-500' : 'bg-gray-300'}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                        {contact.name}
                                    </p>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {role && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium dark:bg-blue-900/30 dark:text-blue-300">
                                                {role}
                                            </span>
                                        )}
                                        {unitName ? (
                                            <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5">
                                                <Building2 size={9} /> {unitName}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-gray-400 italic">Unassigned</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
