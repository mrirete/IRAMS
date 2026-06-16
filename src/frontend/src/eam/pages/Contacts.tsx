
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
    Trash2, Plus, Edit2, Search, Filter, MoreHorizontal, Mail, Phone, MapPin, User as UserIcon, Building2,
    Briefcase, FileText, Calendar, DollarSign, CheckSquare, Settings, Truck, Box, Users, X,
    Award, Clock, Save, Shield, Key, Factory, List, Network, Paperclip, Book, ShoppingCart, Sliders,
    UserPlus, Upload
} from 'lucide-react';
import { MOCK_USERS, MOCK_WORK_ORDERS } from '../constants';
import { Contact, Qualification, CustomField, WorkOrder, DictionaryEntry, User } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { Button } from '../components/ui';
import { UnifiedTabBar } from '../components/ui/UnifiedTabBar';
// Firestore imports removed in favor of DatabaseService (Supabase)

interface ContactsProps {
    onAnalyze?: (context: string) => void;
}

type TabId =
    | 'details' | 'properties' | 'fields' | 'models' | 'children'
    | 'jobs' | 'files' | 'journals' | 'labour' | 'qualifications'
    | 'purchasing' | 'inventory' | 'settings';

import {
    DetailsTab, PropertiesTab, FieldsTab, ModelsTab, ChildrenTab,
    JobsTab, FilesTab, LaborTab, QualificationsTab, JournalsTab
} from './ContactsTabs';

import { AddContactModal } from '../components/modals/AddContactModal';
import BulkImportModal from '../components/modals/BulkImportModal';
import { OrgChart } from '../components/OrgChart';
import { ConfirmationModal, ConfirmationType } from '../components/modals/ConfirmationModal';
import type { ImportType } from '../services/assetTemplates';

// --- Sub-Components (Modals) ---

// --- Sub-Components (User Accounts) ---

// UserAccountsManager removed - fused into main Contacts view

export const Contacts: React.FC<ContactsProps> = ({ onAnalyze }) => {
    const { permissions } = useAuth();
    const { showToast } = useToast();
    const canCreate = permissions?.contacts?.create === true;
    const canEdit = permissions?.contacts?.edit === true;
    const canDelete = permissions?.contacts?.delete === true;
    const [searchParams, setSearchParams] = useSearchParams();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [viewMode, setViewMode] = useState<'directory' | 'orgChart'>('directory');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(false);

    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; contactId: string | null; contactName: string }>({
        isOpen: false,
        contactId: null,
        contactName: ''
    });
    const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
    const [bulkDeleteModal, setBulkDeleteModal] = useState(false);

    // Generic Modal State (Alerts & Confirms)
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: ConfirmationType;
        onConfirm?: () => void;
    }>({ isOpen: false, title: '', message: '', type: 'info' });

    const showModal = (title: string, message: string, type: ConfirmationType = 'info', onConfirm?: () => void) => {
        setModalConfig({ isOpen: true, title, message, type, onConfirm });
    };

    // Load Contacts & Users
    React.useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [contactData, dictData, userData] = await Promise.all([
                db.getContacts(),
                db.getDictionaries(),
                db.getUsers()
            ]);
            setContacts(contactData || []);
            setDictionaries(dictData || []);
            setUsers(userData as any || []);

            // Auto-select contact from URL ?id= param (e.g. from TopBar "My Profile")
            const targetId = searchParams.get('id');
            if (targetId && contactData) {
                const match = contactData.find(c => c.id === targetId);
                if (match) {
                    setSelectedContact(match);
                    // Clear the param so it doesn't persist on refresh
                    setSearchParams({}, { replace: true });
                }
            }
        } catch (e) {
            console.error("Failed to load data", e);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteClick = (contact: Contact) => {
        setDeleteModal({
            isOpen: true,
            contactId: contact.id,
            contactName: contact.name
        });
    };

    const handleConfirmDelete = async () => {
        if (!deleteModal.contactId) return;
        setLoading(true);
        try {
            const id = deleteModal.contactId;
            const db = DatabaseService.getInstance();
            // Determine if this is a Real Contact or a Virtual User
            const isRealContact = contacts.some(c => c.id === id);

            if (isRealContact) {
                await db.deleteContact(id);
            } else {
                await db.deleteUser(id);
            }

            await loadData();
            if (selectedContact?.id === id) {
                setSelectedContact(null);
            }
            showModal('Success', isRealContact ? 'Contact deleted successfully.' : 'System User account deleted.', 'success');
        } catch (e: any) {
            showModal('Delete Failed', e.message, 'danger');
        } finally {
            setLoading(false);
            setDeleteModal({ isOpen: false, contactId: null, contactName: '' });
        }
    };

    // Old function kept for reference or direct calls if needed, but UI uses new flow
    const handleDeleteContact = async (id: string) => {
        // ... Logic moved to handleConfirmDelete
    };

    const handleDuplicateContact = async (original: Contact) => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            // Create deep clone to avoid mutation
            const newContact: Contact = JSON.parse(JSON.stringify(original));

            newContact.id = crypto.randomUUID();
            newContact.code = original.code + ' -COPY';
            newContact.name = original.name + ' (Copy)';
            newContact.email = ''; // Clear email to avoid unique constraint
            newContact.organizationUnitIds = []; // Clear org units to start fresh

            // Clear system access flags
            if (newContact.flags) {
                newContact.flags.canLogin = false;
                newContact.flags.isVirtual = false;
            }

            await db.addContact(newContact);
            await loadData();

            // Select the new contact
            setSelectedContact(newContact);
            showModal('Success', 'Contact duplicated. Please update details.', 'success');
        } catch (e: any) {
            console.error(e);
            showModal('Error', 'Failed to duplicate contact: ' + e.message, 'danger');
        } finally {
            setLoading(false);
        }
    };

    // Merge Real Contacts + Virtual User Contacts
    const mergedContacts = React.useMemo(() => {
        const list = Array.isArray(contacts) ? [...contacts] : [];
        const userList = Array.isArray(users) ? users : [];

        userList.forEach(u => {
            // Check if user is already linked
            const isLinked = list.some(c => c.id === u.contactId || c.id === u.contact_id);
            if (!isLinked) {
                // Create Virtual Contact
                list.push({
                    id: u.id, // Use User ID for vitual contact
                    name: u.username,
                    code: 'SYS-USER',
                    title: 'System Account',
                    email: u.email || '',
                    phone: '',
                    mobile: '',
                    active: u.status === 'active',
                    types: ['SYSTEM_USER'],
                    defaultType: 'SYSTEM_USER',
                    flags: {
                        isVirtual: true,
                        canLogin: true
                    },
                    customFields: [],
                    address: { street: '', city: '', state: '', zip: '', country: '' }
                } as Contact);
            }
        });

        return list;
    }, [contacts, users]);

    // Helper to resolve dictionary codes to descriptions
    const getContactTypeLabel = (code: string) => {
        if (code === 'SYSTEM_USER') return 'System User';
        const entry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === code);
        return entry ? entry.description : code;
    };

    // Check System Access (Is there a linked User?)
    const getSystemUser = (contactId: string) => {
        // Find user where contact_id equals this contact's ID
        // Note: The User type has 'contactId' or 'contact_id' depending on snake/camel case issues we saw earlier.
        // We'll check both safe side.
        return users.find(u => (u as any).contactId === contactId || u.contact_id === contactId);
    };




    const hasManufacturerRole = Array.isArray(selectedContact?.types) && Array.isArray(dictionaries) && selectedContact.types.some(t => {
        const entry = dictionaries.find(d => d.type === 'CONTACT_TYPE' && d.code === t);
        return entry?.isManufacturer === true;
    });


    const handleDuplicate = async () => {
        if (!selectedContact) return;

        const performDuplicate = async () => {
            setLoading(true);
            try {
                const db = DatabaseService.getInstance();
                const newContact: Contact = {
                    ...selectedContact,
                    id: crypto.randomUUID(),
                    name: selectedContact.name + ' (Copy)',
                    code: selectedContact.code + ' -CPY',
                    customFields: selectedContact.customFields || []
                };

                await db.addContact(newContact);
                await loadData();
                setSelectedContact(newContact);
                showModal('Success', 'Contact duplicated successfully.', 'success');
            } catch (e: any) {
                console.error("Duplicate failed", e);
                showModal('Duplicate Failed', e.message, 'danger');
            } finally {
                setLoading(false);
            }
        };

        showModal(
            'Confirm Duplicate',
            "Create a copy of '" + selectedContact.name + "'?",
            'info',
            performDuplicate
        );
    };

    // --- Bulk Import Handler for People ---
    const handleBulkImportData = async (type: ImportType, rows: Record<string, string>[]) => {
        if (type !== 'people') return;
        const db = DatabaseService.getInstance();
        let imported = 0;
        for (const row of rows) {
            try {
                const newContact: Contact = {
                    id: crypto.randomUUID(),
                    code: row['code'] || `PER-${Date.now()}-${imported}`,
                    name: row['name'] || 'Imported Contact',
                    title: row['title'] || '',
                    defaultType: row['type'] ? row['type'].toUpperCase() : 'TECHNICIAN',
                    email: row['email'] || '',
                    phone: row['phone'] || '',
                    mobile: row['mobile'] || '',
                    types: row['type'] ? [row['type'].toUpperCase()] : ['TECHNICIAN'],
                    roles: row['role'] ? [row['role']] : [],
                    department: row['department'] || '',
                    site: row['site'] || '',
                    reportingTo: row['reportingto'] || '',
                    active: (row['status'] || 'Active').toLowerCase() !== 'inactive',
                    customFields: [],
                    qualifications: [],
                    flags: {},
                };
                await db.addContact(newContact);
                imported++;
            } catch (e: any) {
                console.warn(`Failed to import contact row: ${row['code']}`, e);
            }
        }
        showModal('Import Complete', `Successfully imported ${imported} of ${rows.length} contacts.`, imported === rows.length ? 'success' : 'warning');
        loadData();
    };

    // --- Filtered list for rendering ---
    const filteredContacts = mergedContacts
        .filter(c =>
            (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (Array.isArray(c.types) && c.types.some(t => t.toLowerCase().includes(searchTerm.toLowerCase())))) &&
            (!Array.isArray(c.types) || !c.types.some(t => ['VENDOR', 'MANUFACTURER', 'SUPPLIER'].includes(t)))
        )
        .sort((a, b) => a.name.localeCompare(b.name));

    // --- Bulk Selection Handlers ---
    const toggleSelectContact = (id: string) => {
        setSelectedContactIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAllContacts = () => {
        if (selectedContactIds.size === filteredContacts.length) {
            setSelectedContactIds(new Set());
        } else {
            setSelectedContactIds(new Set(filteredContacts.map(c => c.id)));
        }
    };

    const handleBulkDeleteContacts = async () => {
        if (!canDelete) {
            console.warn('[RBAC-AUDIT] BLOCKED: contacts.bulkDelete attempt by unauthorized user');
            showToast('Access Denied: You do not have permission to delete contacts.', 'error');
            return;
        }
        const db = DatabaseService.getInstance();
        const ids = Array.from(selectedContactIds);
        let deleted = 0;
        for (const id of ids) {
            try {
                const isRealContact = contacts.some(c => c.id === id);
                if (isRealContact) {
                    await db.deleteContact(id);
                } else {
                    await db.deleteUser(id);
                }
                deleted++;
            } catch (e: any) {
                console.warn(`Failed to delete contact ${id}:`, e.message);
            }
        }
        setSelectedContactIds(new Set());
        setBulkDeleteModal(false);
        if (selectedContact && ids.includes(selectedContact.id)) setSelectedContact(null);
        await loadData();
        showModal('Bulk Delete Complete', `Deleted ${deleted} of ${ids.length} contact(s).`, deleted === ids.length ? 'success' : 'warning');
    };

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Top Navigation */}
            <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 pb-2">
                <button
                    onClick={() => setViewMode('directory')}
                    className={"px-4 py-2 text-sm font-medium rounded-lg transition-colors " + (viewMode === 'directory' ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800")}
                >
                    Directory
                </button>
                <button
                    onClick={() => setViewMode('orgChart')}
                    className={"px-4 py-2 text-sm font-medium rounded-lg transition-colors " + (viewMode === 'orgChart' ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800")}
                >
                    Organization Chart
                </button>
            </div>

            {viewMode === 'orgChart' ? (
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-auto">
                    <OrgChart />
                </div>
            ) : (
                <div className="flex h-full gap-6 overflow-hidden">
                    {/* Left Side: Container */}
                    {/* Left Side: Container */}
                    <div className={(selectedContact ? "hidden lg:flex w-full lg:w-1/3" : "w-full flex") + " flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-300"}>

                        {/* Header Section */}
                        <div className="p-4 border-b border-slate-100 bg-white flex flex-col gap-4">
                            <div className="flex flex-wrap justify-between items-center gap-2">
                                <div className="flex items-center gap-2">
                                    <Users className="text-blue-600" size={24} />
                                    <h2 className="text-xl font-bold text-slate-900">Directory & Access</h2>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <AskRelanternButton
                                        contextType="people"
                                        contextSummary={`People & Workforce: ${mergedContacts.length} total contacts. Active: ${mergedContacts.filter(c => c.active).length}. System Users: ${users.length}. Roles: ${[...new Set(mergedContacts.flatMap(c => c.types))].join(', ')}. Ask about workforce competency gaps, qualification compliance, labor utilization, succession planning, or organizational optimization.`}
                                        compact
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap justify-between items-center gap-2">
                                <div className="relative flex-1 max-w-md">
                                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Search name, code, role..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500 focus:outline-none"
                                    />
                                </div>
                                <button
                                    onClick={() => setShowBulkImport(true)}
                                    disabled={!canCreate}
                                    className={`ml-2 hidden sm:flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg transition shadow-sm font-medium text-sm ${!canCreate ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                                    title={!canCreate ? 'Insufficient permissions' : 'Bulk Import People'}
                                >
                                    <Upload size={16} /> Import
                                </button>
                                <Button
                                    onClick={() => setIsAddModalOpen(true)}
                                    disabled={!canCreate}
                                    leftIcon={<Plus size={18} />}
                                    className="ml-2 hidden sm:inline-flex"
                                    title={!canCreate ? 'Insufficient permissions' : 'Add new person'}
                                >
                                    Add Person
                                </Button>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="flex-1 overflow-auto table-responsive">
                            {/* Bulk Action Bar */}
                            {selectedContactIds.size > 0 && (
                                <div className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between gap-3 sticky top-0 z-20 animate-in slide-in-from-top duration-200">
                                    <div className="flex items-center gap-2">
                                        <CheckSquare size={16} className="text-white/80" />
                                        <span className="text-sm font-semibold text-white">{selectedContactIds.size} person{selectedContactIds.size > 1 ? 's' : ''} selected</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setSelectedContactIds(new Set())}
                                            className="px-3 py-1 text-xs font-medium text-white/90 bg-white/15 hover:bg-white/25 rounded-md transition"
                                        >
                                            Clear
                                        </button>
                                        <button
                                            onClick={() => setBulkDeleteModal(true)}
                                            disabled={!canDelete}
                                            className={`px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition ${!canDelete ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600 shadow-sm'}`}
                                            title={!canDelete ? 'Insufficient permissions' : 'Delete selected'}
                                        >
                                            <Trash2 size={13} /> Delete Selected
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* ═══ Mobile Card View (≤640px) ═══ */}
                            <div className="mobile-cards">
                                {filteredContacts.map((contact) => (
                                    <div
                                        key={contact.id}
                                        className={`mobile-card-contact ${selectedContact?.id === contact.id ? 'bg-blue-50' : ''}`}
                                        onClick={() => { setSelectedContact(contact); setSelectedContactIds(new Set()); }}
                                    >
                                        <div className={`mobile-card-contact-avatar ${contact.flags?.isVirtual ? 'bg-orange-100 text-orange-600' : 'bg-slate-200 text-slate-500'}`}>
                                            {contact.image ? <img src={contact.image} alt="" className="h-full w-full object-cover" /> : (contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?')}
                                        </div>
                                        <div className="mobile-card-contact-body">
                                            <div className="mobile-card-contact-name">{contact.name}</div>
                                            <div className="mobile-card-contact-sub">
                                                {contact.types.map(t => getContactTypeLabel(t)).join(', ')} {contact.email ? `· ${contact.email}` : ''}
                                            </div>
                                        </div>
                                        <div className="mobile-card-contact-badge">
                                            {contact.active ? (
                                                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" title="Active"></span>
                                            ) : (
                                                <span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" title="Inactive"></span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* ═══ Desktop Table View (≥640px) ═══ */}
                            <div className="desktop-table">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-3 py-3 w-10">
                                            <input
                                                type="checkbox"
                                                checked={selectedContactIds.size === filteredContacts.length && filteredContacts.length > 0}
                                                onChange={toggleSelectAllContacts}
                                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500 cursor-pointer"
                                                title="Select all"
                                            />
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Name / Code</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                                        {!selectedContact && (
                                            <>
                                                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Contact Info</th>
                                                <th className="px-6 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">System Access</th>
                                                <th className="px-6 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-slate-200">
                                    {filteredContacts
                                        .map((contact) => {
                                            const systemUser = getSystemUser(contact.id);
                                            return (
                                                <tr
                                                    key={contact.id}
                                                    onClick={() => { setSelectedContact(contact); setSelectedContactIds(new Set()); }}
                                                    className={"cursor-pointer transition hover:bg-slate-50 " + (selectedContact?.id === contact.id ? "bg-blue-50" : selectedContactIds.has(contact.id) ? "bg-blue-50/50" : "")}
                                                >
                                                    <td className="px-3 py-4 w-10" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedContactIds.has(contact.id)}
                                                            onChange={() => toggleSelectContact(contact.id)}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500 cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex items-center">
                                                            <div className={"flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center font-bold overflow-hidden " + (contact.flags?.isVirtual ? "bg-orange-100 text-orange-600" : "bg-slate-200 text-slate-500")}>
                                                                {contact.image ? <img src={contact.image} alt="" className="h-full w-full object-cover" /> : (contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?')}
                                                            </div>
                                                            <div className="ml-4">
                                                                <div className="text-sm font-medium text-slate-900">{contact.name}</div>
                                                                <div className="text-xs text-slate-500">{contact.code}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                                                            {contact.types.map(t => (
                                                                <span key={t} className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                                                                    {getContactTypeLabel(t)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-1">{contact.title}</div>
                                                    </td>
                                                    {!selectedContact && (
                                                        <>
                                                            <td className="px-6 py-4 whitespace-nowrap">
                                                                <div className="text-sm text-slate-900 flex items-center gap-1"><Mail size={12} className="text-slate-400" /> {contact.email || '-'}</div>
                                                                <div className="text-sm text-slate-500 flex items-center gap-1"><Phone size={12} className="text-slate-400" /> {contact.mobile || contact.phone || '-'}</div>
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                                {systemUser ? (
                                                                    <div className="flex flex-col items-center">
                                                                        <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 border border-green-200 gap-1 items-center">
                                                                            <UserIcon size={12} /> Yes
                                                                        </span>
                                                                        <span className="text-[10px] text-slate-400 mt-1 font-mono">@{systemUser.username}</span>
                                                                    </div>
                                                                ) : (
                                                                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                                                                        No Access
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                                {contact.active ? (
                                                                    <span className="text-green-600 text-xs font-bold">Active</span>
                                                                ) : (
                                                                    <span className="text-red-500 text-xs font-bold">Inactive</span>
                                                                )}
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                            </div>
                        </div>

                        {/* Handlers for Delete/Duplicate passed to DetailsTab */}
                        {/* Handlers implemented in component body */}

                        {/* Floating Add Modal */}
                        {isAddModalOpen && (
                            <AddContactModal
                                contactTypes={dictionaries.filter(d => d.type === 'CONTACT_TYPE')}
                                costCenters={dictionaries.filter(d => d.type === 'COST_CENTRE')}
                                onClose={() => setIsAddModalOpen(false)}
                                onSave={(newContact) => {
                                    loadData(); // Reload both contacts and users
                                    setIsAddModalOpen(false);
                                    setSelectedContact(newContact);
                                }}
                                existingUser={selectedContact?.flags?.isVirtual ? {
                                    id: selectedContact.id,
                                    username: selectedContact.name,
                                    email: selectedContact.email
                                } : undefined}
                            />
                        )}

                        {/* Confirmation Modal */}
                        <ConfirmationModal
                            isOpen={modalConfig.isOpen}
                            onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                            onConfirm={modalConfig.onConfirm}
                            title={modalConfig.title}
                            message={modalConfig.message}
                            type={modalConfig.type}
                        />
                    </div>

                    {/* Detail Panel (Right Side) */}
                    {selectedContact && (
                        <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden relative animate-in slide-in-from-right duration-300">
                            <UnifiedDetailHeader
                                title={selectedContact.name}
                                subtitle={selectedContact.title || selectedContact.code}
                                icon={
                                    <div className="h-10 w-10 rounded-full overflow-hidden border border-slate-200 bg-white flex items-center justify-center flex-shrink-0">
                                        {selectedContact.image ? (
                                            <img src={selectedContact.image} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <span className="text-lg font-bold text-slate-400">
                                                {(selectedContact.firstName?.[0] || selectedContact.name?.[0] || '?').toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                }
                                onClose={() => setSelectedContact(null)}
                                badges={
                                    selectedContact.flags?.isVirtual ? (
                                        <span className="text-[10px] font-semibold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded border border-orange-200">
                                            System Account (No Profile)
                                        </span>
                                    ) : undefined
                                }
                                actions={
                                    selectedContact.flags?.isVirtual ? [
                                        { label: 'Create Profile', icon: <UserPlus size={14} />, onClick: () => setIsAddModalOpen(true), variant: 'primary' as const, disabled: !canCreate },
                                    ] : [
                                        { label: 'New', icon: <Plus size={14} />, onClick: () => setIsAddModalOpen(true), variant: 'ghost' as const, disabled: !canCreate },
                                        { label: 'Duplicate', icon: <Edit2 size={14} />, onClick: handleDuplicate, variant: 'ghost' as const, disabled: !canCreate },
                                        { label: 'Delete', icon: <Trash2 size={14} />, onClick: () => handleDeleteClick(selectedContact), variant: 'danger' as const, disabled: !canDelete },
                                        {
                                            label: 'Save',
                                            icon: <Save size={14} />,
                                            disabled: !canEdit,
                                            onClick: async () => {
                                                setLoading(true);
                                                try {
                                                    await DatabaseService.getInstance().updateContact(selectedContact);
                                                    await loadData();
                                                    showModal('Success', 'Contact saved.', 'success');
                                                } catch (e: any) {
                                                    showModal('Save Failed', e.message, 'danger');
                                                } finally { setLoading(false); }
                                            },
                                            variant: 'primary' as const,
                                        },
                                    ]
                                }
                            />

                            {/* Tabs */}
                            <UnifiedTabBar
                                tabs={[
                                    { id: 'details', label: 'Details', icon: FileText },
                                    { id: 'properties', label: 'Properties', icon: Settings },
                                    { id: 'fields', label: 'Fields', icon: Sliders },
                                    ...(hasManufacturerRole ? [{ id: 'models', label: 'Models', icon: Factory }] : []),
                                    { id: 'children', label: 'Children', icon: Network },
                                    { id: 'files', label: 'Files', icon: Paperclip },
                                    { id: 'jobs', label: 'Jobs', icon: Briefcase },
                                    ...((selectedContact.flags?.hasQualifications || selectedContact.flags?.isLabour) ? [
                                        { id: 'labour', label: 'Labor', icon: Clock },
                                        { id: 'qualifications', label: 'Quals', icon: Award },
                                    ] : []),
                                    { id: 'journals', label: 'Journal', icon: Book },
                                ]}
                                activeTab={activeTab}
                                onTabChange={(id) => setActiveTab(id as TabId)}
                            />

                            <div className="flex-1 overflow-y-auto bg-white p-4">
                                {activeTab === 'details' && (
                                    <div className="space-y-6">
                                        <DetailsTab
                                            contact={selectedContact}
                                            allContacts={mergedContacts || []}
                                            dictionaries={dictionaries || []}
                                            onChange={setSelectedContact}
                                            onDelete={handleDeleteContact}
                                            onDuplicate={handleDuplicateContact}
                                        />
                                    </div>
                                )}
                                {activeTab === 'properties' && <PropertiesTab contact={selectedContact} users={users} onChange={setSelectedContact} />}
                                {activeTab === 'fields' && <FieldsTab contact={selectedContact} onChange={setSelectedContact} />}
                                {activeTab === 'models' && <ModelsTab contact={selectedContact} />}
                                {activeTab === 'children' && <ChildrenTab contact={selectedContact} allContacts={contacts} onSelect={setSelectedContact} />}
                                {activeTab === 'files' && <FilesTab contact={selectedContact} />}
                                {activeTab === 'jobs' && <JobsTab contact={selectedContact} />}
                                {activeTab === 'labour' && <LaborTab contact={selectedContact} onChange={setSelectedContact} />}
                                {activeTab === 'qualifications' && <QualificationsTab contact={selectedContact} />}
                                {activeTab === 'journals' && <JournalsTab contact={selectedContact} />}
                            </div>
                        </div>
                    )}

                    {/* ═══ Mobile FAB — Add Person (RBAC-gated, ≤640px only) ═══ */}
                    {!selectedContact && canCreate && (
                        <button
                            className="fab"
                            onClick={() => setIsAddModalOpen(true)}
                            aria-label="Add Person"
                        >
                            <Plus size={24} />
                        </button>
                    )}
                </div>
            )}
            {/* Bulk Import Modal */}
            <BulkImportModal
                isOpen={showBulkImport}
                onClose={() => setShowBulkImport(false)}
                preSelectedType="people"
                onImportData={handleBulkImportData}
            />
            {/* Add Contact Modal is rendered inside left panel (line ~476) */}
            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, contactId: null, contactName: '' })}
                onConfirm={handleConfirmDelete}
                title="Delete Contact?"
                message={"Are you sure you want to delete \"" + deleteModal.contactName + "\"? This action cannot be undone and may be blocked if the contact has active work orders."}
                type="danger"
                confirmText="Delete Contact"
            />
            {/* Bulk Delete Confirmation */}
            <ConfirmationModal
                isOpen={bulkDeleteModal}
                onClose={() => setBulkDeleteModal(false)}
                onConfirm={handleBulkDeleteContacts}
                title="Delete Selected People?"
                message={`You are about to permanently delete ${selectedContactIds.size} contact(s). Linked system user accounts will be unlinked. This action cannot be undone.`}
                type="danger"
                confirmText={`Delete ${selectedContactIds.size} Person${selectedContactIds.size > 1 ? 's' : ''}`}
            />
        </div>
    );
};

// --- Sub-Components moved to ContactsTabs.tsx ---

