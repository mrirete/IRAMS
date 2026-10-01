
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StorageImage } from '../components/ui/StorageImage';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
    Trash2, Plus, Edit2, Search, Filter, MoreHorizontal, Mail, Phone, MapPin, User as UserIcon, Building2,
    Briefcase, FileText, Calendar, DollarSign, CheckSquare, Settings, Truck, Box, Users, X,
    Award, Clock, Save, Shield, Key, Factory, List, Network, Paperclip, Book, ShoppingCart, Sliders,
    UserPlus, Upload, Lock, Unlock, UserX, UserCheck
} from 'lucide-react';
import { Contact, Qualification, CustomField, WorkOrder, DictionaryEntry, User, OrganizationUnit } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { emptyResult, tally, errMessage } from '../services/importTypes';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { Button } from '../components/ui';
import { Drawer } from '../components/ui/Overlay';
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

/** Indents a <select> option; a plain space collapses in an option label. */
const NBSP = '\u00A0';

/** The directory lists people; vendors and manufacturers have their own page. */
const isPerson = (c: Contact) => !Array.isArray(c.types) || !c.types.some(t => ['VENDOR', 'MANUFACTURER', 'SUPPLIER'].includes(t));

type PersonState = 'active' | 'login_disabled' | 'inactive';
const PERSON_STATE_LABEL: Record<PersonState, string> = {
    active: 'Active',
    login_disabled: 'Login disabled',
    inactive: 'Inactive',
};

export const Contacts: React.FC<ContactsProps> = ({ onAnalyze }) => {
    const { permissions, role } = useAuth();
    // Deactivation runs through admin-only RPCs (0398); offering it to anyone
    // else only produces a refusal.
    const isAdmin = role === 'SUPER_ADMIN' || role === 'SYS_ADMIN';
    const { showToast } = useToast();
    const canCreate = permissions?.contacts?.create === true;
    const canEdit = permissions?.contacts?.edit === true;
    const canDelete = permissions?.contacts?.delete === true;
    const [searchParams, setSearchParams] = useSearchParams();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [orgUnits, setOrgUnits] = useState<OrganizationUnit[]>([]);
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
    const [activeTab, setActiveTab] = useState<TabId>('details');
    const [viewMode, setViewMode] = useState<'directory' | 'orgChart'>('directory');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(searchParams.get('action') === 'import');

    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('ALL'); // CONTACT_TYPE code, or ALL
    const [unitFilter, setUnitFilter] = useState<string>('ALL'); // org unit id, ALL, or NONE
    const [statusFilter, setStatusFilter] = useState<'ALL' | PersonState>('ALL');
    const [filterSheetOpen, setFilterSheetOpen] = useState(false); // below lg the rail is a sheet
    // Logins with no person record ("SYS-USER / System Account") are noise in a
    // people directory — hidden by default, one toggle to show them, remembered.
    const SHOW_SYSTEM_KEY = 'ers_contacts_show_system_accounts';
    const [showSystemAccounts, setShowSystemAccounts] = useState<boolean>(() => {
        try { return localStorage.getItem(SHOW_SYSTEM_KEY) === '1'; } catch { return false; }
    });
    const toggleSystemAccounts = (on: boolean) => {
        setShowSystemAccounts(on);
        try { localStorage.setItem(SHOW_SYSTEM_KEY, on ? '1' : '0'); } catch { /* private mode: not remembered */ }
    };
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; contactId: string | null; contactName: string }>({
        isOpen: false,
        contactId: null,
        contactName: ''
    });
    const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
    const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
    const [activationModal, setActivationModal] = useState<{ ids: string[]; active: boolean } | null>(null);

    // Generic Modal State (Alerts & Confirms)
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: ConfirmationType;
        onConfirm?: () => void;
        confirmText?: string;
    }>({ isOpen: false, title: '', message: '', type: 'info' });

    const showModal = (title: string, message: string, type: ConfirmationType = 'info', onConfirm?: () => void, confirmText?: string) => {
        setModalConfig({ isOpen: true, title, message, type, onConfirm, confirmText });
    };

    // Load Contacts & Users
    React.useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [contactData, dictData, userData, unitData] = await Promise.all([
                db.getContacts(),
                db.getDictionaries(),
                db.getUsers(),
                db.getOrgUnits()
            ]);
            setContacts(contactData || []);
            setDictionaries(dictData || []);
            setUsers(userData as any || []);
            setOrgUnits(unitData || []);

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
            showModal('Success', isRealContact ? 'Contact and any linked login removed.' : 'System user and login removed.', 'success');
        } catch (e: any) {
            if (e?.code === 'HAS_HISTORY') {
                // The honest alternative is one click away, not a dead end.
                const id = deleteModal.contactId;
                showModal('Cannot Delete', `${deleteModal.contactName} ${e.message}`, 'warning',
                    isAdmin ? () => setActivationModal({ ids: [id], active: false }) : undefined,
                    'Deactivate instead');
            } else {
                showModal('Delete Failed', e.message, 'danger');
            }
        } finally {
            setLoading(false);
            setDeleteModal({ isOpen: false, contactId: null, contactName: '' });
        }
    };

    // Resolve a directory entry to its login (auth) user, and whether that login is active.
    const loginInfo = (c: Contact) => {
        const u: any = c.flags?.isVirtual
            ? (users as any[]).find(x => x.id === c.id)
            : (users as any[]).find(x => x.contactId === c.id || x.contact_id === c.id);
        // users.status is 'active' | 'suspended' (CHECK in 0000); NULL is the legacy default.
        return { userId: u?.id as string | undefined, active: u ? ((u.status ?? 'active') === 'active') : true, hasLogin: !!u };
    };

    // One reading of "is this person active" for the table, the filter and the
    // header. The person record (contacts.is_active) and the login
    // (users.status) are separate switches; set_person_active moves both, but a
    // login can still be disabled on its own.
    const personState = (c: Contact): PersonState => {
        if (!c.active) return 'inactive';
        const li = loginInfo(c);
        return li.hasLogin && !li.active ? 'login_disabled' : 'active';
    };

    const handleToggleLogin = async (userId: string, active: boolean) => {
        setLoading(true);
        try {
            await DatabaseService.getInstance().setUserLoginActive(userId, active);
            await loadData();
            showModal('Success', active
                ? 'Login enabled — this user can sign in again.'
                : 'Login disabled — this user can no longer sign in and any open session has ended (profile kept).', 'success');
        } catch (e: any) {
            showModal('Update Failed', e.message, 'danger');
        } finally { setLoading(false); }
    };

    // Deactivate / Reactivate the open person (record + login together), and,
    // when only the login is off, a way to turn just that back on.
    const activationActions = () => {
        if (!selectedContact) return [] as any[];
        const state = personState(selectedContact);
        const tooltip = isAdmin ? undefined : 'Only an administrator can change this';
        if (state === 'inactive') {
            return [{
                label: 'Reactivate', icon: <UserCheck size={14} />, variant: 'ghost' as const,
                onClick: () => setActivationModal({ ids: [selectedContact.id], active: true }),
                disabled: !isAdmin, tooltip,
            }];
        }
        const li = loginInfo(selectedContact);
        return [
            ...(state === 'login_disabled' && li.userId ? [{
                label: 'Enable Login', icon: <Unlock size={14} />, variant: 'ghost' as const,
                onClick: () => handleToggleLogin(li.userId!, true),
                disabled: !isAdmin, tooltip,
            }] : []),
            {
                label: 'Deactivate', icon: <UserX size={14} />, variant: 'ghost' as const,
                onClick: () => setActivationModal({ ids: [selectedContact.id], active: false }),
                disabled: !isAdmin, tooltip,
            },
        ];
    };

    const ACTIVATION_REFUSALS: Record<string, string> = {
        self: 'that is your own account — another administrator has to do it',
        not_found: 'no longer exists',
    };

    const handleSetActive = async (ids: string[], active: boolean) => {
        setActivationModal(null);
        if (!isAdmin) {
            showToast('Only an administrator can deactivate or reactivate people.', 'error');
            return;
        }
        setLoading(true);
        const db = DatabaseService.getInstance();
        const nameOf = (id: string) => mergedContacts.find(c => c.id === id)?.name || id;
        const done: string[] = [];
        const refused: string[] = [];
        let sessions = 0;
        for (const id of ids) {
            try {
                const r = await db.setPersonActive(id, active);
                if (r.ok) { done.push(r.name || nameOf(id)); sessions += r.sessionsEnded || 0; }
                else refused.push(`${r.name || nameOf(id)}: ${ACTIVATION_REFUSALS[r.reason || ''] || r.reason || 'refused'}`);
            } catch (e: any) {
                refused.push(`${nameOf(id)}: ${e.message}`);
                if (/migration 0398/.test(e.message)) break; // same answer for every row
            }
        }
        setSelectedContactIds(new Set());
        await loadData();
        setLoading(false);
        const verb = active ? 'Reactivated' : 'Deactivated';
        const lines = [`${verb} ${done.length} of ${ids.length}.`];
        if (done.length && !active) {
            lines.push('They can no longer sign in' + (sessions ? ` (${sessions} open session${sessions > 1 ? 's' : ''} ended)` : '') + ' and drop out of assignment lists. Their history stays.');
        }
        if (done.length && active) lines.push('Anyone with a login can sign in again.');
        if (ids.length > 1 && done.length) lines.push('', ...done.map(n => '• ' + n));
        if (refused.length) lines.push('', 'Not changed:', ...refused.map(r => '• ' + r));
        showModal(
            refused.length ? `${verb} With Exceptions` : `${verb}`,
            lines.join('\n'),
            refused.length ? (done.length ? 'warning' : 'danger') : 'success');
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
                        isVirtual: true
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
        const res = emptyResult();

        // These used to read row['role'], row['site'], row['reportingto'] and
        // row['status'] — none of which the People template ships — while
        // dropping the columns it does ship (orgUnit, costCenter, hourlyRate,
        // currency, qualifications).
        const existingCodes = new Set(contacts.map(c => (c.code || '').toUpperCase()));

        // orgUnit and costCenter arrive as names/codes; the person carries ids.
        // They were set on fields addContact never wrote, so every row said
        // "inserted" with its unit and cost centre gone. Resolve them, and say
        // which values matched nothing instead of dropping them quietly.
        const norm = (v: string) => v.trim().toLowerCase();
        const unitByKey = new Map<string, string>();
        orgUnits.forEach(u => { unitByKey.set(norm(u.name || ''), u.id); if (u.code) unitByKey.set(norm(u.code), u.id); });
        const ccByKey = new Map<string, string>();
        dictionaries.filter(d => d.type === 'COST_CENTRE').forEach(d => {
            ccByKey.set(norm(d.code || ''), d.id);
            if (d.description) ccByKey.set(norm(d.description), d.id);
        });
        const unknownUnits = new Map<string, number>();
        const unknownCcs = new Map<string, number>();
        const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNo = Number(row.__row) || i + 2;
            const code = row['code'] || `PER-${Date.now()}-${i}`;

            if (existingCodes.has(code.toUpperCase())) {
                tally(res, { row: rowNo, key: code, status: 'skipped', reason: 'Contact code already exists' });
                continue;
            }

            try {
                // Template ships a delimited list of names; the model wants
                // records. Imported ones carry no expiry, so they land Pending
                // for a planner to complete rather than claiming to be valid.
                const quals: Qualification[] = (row['qualifications'] || '')
                    .split(/[;,]/).map(q => q.trim()).filter(Boolean)
                    .map(name => ({
                        id: crypto.randomUUID(),
                        name,
                        type: 'IMPORTED',
                        dateExpires: '',
                        status: 'Pending' as const,
                        notes: 'Imported — confirm expiry date',
                    }));
                const unitRaw = (row['orgunit'] || '').trim();
                const unitId = unitRaw ? unitByKey.get(norm(unitRaw)) : undefined;
                if (unitRaw && !unitId) bump(unknownUnits, unitRaw);
                const ccRaw = (row['costcenter'] || '').trim();
                const ccId = ccRaw ? ccByKey.get(norm(ccRaw)) : undefined;
                if (ccRaw && !ccId) bump(unknownCcs, ccRaw);
                const newContact: Contact = {
                    id: crypto.randomUUID(),
                    code,
                    name: row['name'] || 'Imported Contact',
                    title: row['title'] || '',
                    defaultType: row['type'] ? row['type'].toUpperCase() : 'TECHNICIAN',
                    email: row['email'] || '',
                    phone: row['phone'] || '',
                    mobile: row['mobile'] || '',
                    types: row['type'] ? [row['type'].toUpperCase()] : ['TECHNICIAN'],
                    roles: [],
                    department: row['department'] || undefined,
                    organizationUnitIds: unitId ? [unitId] : [],
                    costCenterId: ccId,
                    hourlyRate: parseFloat(row['hourlyrate'] || '0') || 0,
                    currency: (row['currency'] || '').trim().toUpperCase() || undefined,
                    site: '',
                    reportingTo: '',
                    active: true,
                    customFields: [],
                    qualifications: quals,
                    flags: {},
                } as Contact;
                await db.addContact(newContact);
                existingCodes.add(code.toUpperCase());
                tally(res, { row: rowNo, key: code, status: 'inserted' });
            } catch (e: unknown) {
                tally(res, { row: rowNo, key: code, status: 'failed', reason: errMessage(e) });
            }
        }

        const listUnknown = (m: Map<string, number>) =>
            Array.from(m.entries()).slice(0, 8).map(([k, n]) => `"${k}" (${n} row${n > 1 ? 's' : ''})`).join(', ') + (m.size > 8 ? `, and ${m.size - 8} more` : '');
        if (unknownUnits.size) res.notes!.push(`Organisation unit not found, people imported without one: ${listUnknown(unknownUnits)}. Build the unit on the Organization Chart tab, then assign them.`);
        if (unknownCcs.size) res.notes!.push(`Cost centre not found, people imported without one: ${listUnknown(unknownCcs)}.`);
        if (res.inserted > 0) {
            res.notes!.push('Imported people can see nothing until they are invited — use Admin › Migration Center to send login invites in bulk.');
        }
        showModal('Import Complete', `Imported ${res.inserted} of ${rows.length} contacts.`, res.failed === 0 ? 'success' : 'warning');
        loadData();
        return res;
    };

    // --- Filtered list for rendering ---
    const systemAccountCount = React.useMemo(() => mergedContacts.filter(c => c.flags?.isVirtual).length, [mergedContacts]);
    const people = React.useMemo(
        () => mergedContacts.filter(c => isPerson(c) && (showSystemAccounts || !c.flags?.isVirtual)),
        [mergedContacts, showSystemAccounts]
    );

    // Type dropdown options, most common first.
    const typeOptions = React.useMemo(() => {
        const counts = new Map<string, number>();
        people.forEach(c => (c.types || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [people]);

    // ── Organization structure ──────────────────────────────────────────────
    // The org tree is SITE › DIVISION › DEPARTMENT › SECTION › TEAM, and people
    // are attached at any level. Picking a unit therefore has to include the
    // units beneath it: someone in the Utilities section IS in Operations and
    // IS on the site, and a filter that showed only direct members would report
    // an empty department whose sections are full.
    const orgOptions = React.useMemo(() => {
        const children = new Map<string | null, OrganizationUnit[]>();
        orgUnits.forEach(u => {
            const key = u.parentId ?? null;
            if (!children.has(key)) children.set(key, []);
            children.get(key)!.push(u);
        });
        children.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));

        // Depth-first so the list reads as the chart does, top down.
        const rows: { unit: OrganizationUnit; depth: number; subtree: Set<string> }[] = [];
        const walk = (parent: string | null, depth: number): string[] => {
            const ids: string[] = [];
            for (const unit of (children.get(parent) || [])) {
                const row = { unit, depth, subtree: new Set<string>([unit.id]) };
                rows.push(row);
                walk(unit.id, depth + 1).forEach(id => row.subtree.add(id));
                ids.push(unit.id, ...Array.from(row.subtree));
            }
            return ids;
        };
        walk(null, 0);

        // A unit whose parent row is gone would never be walked, and every person in
        // it would silently drop out of the picker. Surface those at the top level.
        const seen = new Set(rows.map(r => r.unit.id));
        orgUnits.filter(u => !seen.has(u.id)).forEach(unit => {
            const row = { unit, depth: 0, subtree: new Set([unit.id]) };
            rows.push(row);
            walk(unit.id, 1).forEach(id => row.subtree.add(id));
        });

        return rows.map(r => ({
            id: r.unit.id,
            depth: r.depth,
            name: r.unit.name,
            count: people.filter(c => (c.organizationUnitIds || []).some(id => r.subtree.has(id))).length,
            subtree: r.subtree,
        }));
    }, [orgUnits, people]);

    const unassignedCount = people.filter(c => !(c.organizationUnitIds || []).length).length;
    const unitMatch = (c: Contact): boolean => {
        if (unitFilter === 'ALL') return true;
        const ids = c.organizationUnitIds || [];
        if (unitFilter === 'NONE') return ids.length === 0;
        const opt = orgOptions.find(o => o.id === unitFilter);
        return !!opt && ids.some(id => opt.subtree.has(id));
    };

    const filteredContacts = people
        .filter(c =>
            (c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (Array.isArray(c.types) && c.types.some(t => t.toLowerCase().includes(searchTerm.toLowerCase())))) &&
            (typeFilter === 'ALL' || (Array.isArray(c.types) && c.types.includes(typeFilter))) &&
            (statusFilter === 'ALL' || personState(c) === statusFilter) &&
            unitMatch(c)
        )
        .sort((a, b) => a.name.localeCompare(b.name));

    const stateCounts = people.reduce((acc, c) => { acc[personState(c)]++; return acc; },
        { active: 0, login_disabled: 0, inactive: 0 } as Record<PersonState, number>);

    // A selection is only meaningful for rows on screen. Kept across a search or
    // filter change it lets "Delete Selected" act on people the user can no
    // longer see.
    useEffect(() => { setSelectedContactIds(new Set()); }, [searchTerm, typeFilter, unitFilter, statusFilter, showSystemAccounts]);

    // The open record is a local copy. After a (de)activation the list reloads
    // but this copy would keep the old `active` — and Save writes is_active
    // from it, silently undoing the change. Carry the fresh value across.
    useEffect(() => {
        if (!selectedContact) return;
        const fresh = mergedContacts.find(c => c.id === selectedContact.id);
        if (fresh && fresh.active !== selectedContact.active) {
            setSelectedContact(prev => prev && prev.id === fresh.id ? { ...prev, active: fresh.active } : prev);
        }
    }, [mergedContacts]); // eslint-disable-line react-hooks/exhaustive-deps

    const activeFilterCount = (typeFilter !== 'ALL' ? 1 : 0) + (unitFilter !== 'ALL' ? 1 : 0) + (statusFilter !== 'ALL' ? 1 : 0);
    const clearFilters = () => { setTypeFilter('ALL'); setUnitFilter('ALL'); setStatusFilter('ALL'); };

    // One set of controls, rendered in the left rail (lg+) or a sheet (below lg).
    const railLabel = 'block mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400';
    const railSelect = 'w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500 truncate';
    const filterControls = (
        <div className="flex flex-col gap-5 text-sm">
            <div>
                <label htmlFor="dir-org" className={railLabel}>Organization</label>
                <select
                    id="dir-org"
                    value={unitFilter}
                    onChange={e => setUnitFilter(e.target.value)}
                    className={railSelect}
                    title={orgOptions.find(o => o.id === unitFilter)?.name || 'All units'}
                >
                    <option value="ALL">All units ({people.length})</option>
                    {orgOptions.map(o => (
                        <option key={o.id} value={o.id}>
                            {NBSP.repeat(o.depth * 2)}{o.depth > 0 ? '\u2514 ' : ''}{o.name} ({o.count})
                        </option>
                    ))}
                    {unassignedCount > 0 && <option value="NONE">Not in the chart ({unassignedCount})</option>}
                </select>
                {orgOptions.length === 0 && (
                    <p className="mt-1.5 text-xs text-slate-400 leading-snug">
                        Build the structure on the Organization Chart tab, then people can be filtered by it.
                    </p>
                )}
            </div>
            <div>
                <label htmlFor="dir-type" className={railLabel}>User type</label>
                <select id="dir-type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={railSelect} title={typeFilter === 'ALL' ? 'All types' : getContactTypeLabel(typeFilter)}>
                    <option value="ALL">All types ({people.length})</option>
                    {typeOptions.map(([t, n]) => <option key={t} value={t}>{getContactTypeLabel(t)} ({n})</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="dir-status" className={railLabel}>Status</label>
                <select id="dir-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | PersonState)} className={railSelect}>
                    <option value="ALL">All ({people.length})</option>
                    {(['active', 'login_disabled', 'inactive'] as PersonState[]).map(st => (
                        <option key={st} value={st}>{PERSON_STATE_LABEL[st]} ({stateCounts[st]})</option>
                    ))}
                </select>
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none" title="Logins that have no person record yet (code SYS-USER)">
                <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-primary-500"
                    checked={showSystemAccounts}
                    onChange={e => toggleSystemAccounts(e.target.checked)}
                />
                <span className="text-xs text-slate-600 leading-snug">
                    Show system accounts
                    {systemAccountCount > 0 && <span className="text-slate-400"> ({systemAccountCount})</span>}
                </span>
            </label>
            {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="text-xs font-medium text-blue-600 hover:underline text-left">
                    Clear filters
                </button>
            )}
        </div>
    );

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
        if (!canDelete || !isAdmin) {
            showToast('Only an administrator can delete people.', 'error');
            return;
        }
        const db = DatabaseService.getInstance();
        const ids = Array.from(selectedContactIds);
        const nameOf = (id: string) => mergedContacts.find(c => c.id === id)?.name || id;
        let deleted = 0;
        const retired: string[] = [];   // login with history: kept, but disabled
        const failed: string[] = [];    // everything else, with the reason
        for (const id of ids) {
            const isRealContact = contacts.some(c => c.id === id);
            try {
                if (isRealContact) {
                    await db.deleteContact(id);
                } else {
                    await db.deleteUser(id);
                }
                deleted++;
            } catch (e: any) {
                if (e?.code === 'HAS_HISTORY') {
                    // Someone with records cannot be deleted (their labour and
                    // records must stay attributable). The closest honest outcome
                    // is to deactivate them: no sign-in, out of the pickers,
                    // history kept. The confirmation said so up front.
                    try {
                        const r = await db.setPersonActive(id, false);
                        if (r.ok) retired.push(`${nameOf(id)} ${e.message.replace(/ Deactivate them instead.*$/, '')}`);
                        else failed.push(`${nameOf(id)}: has records, and could not be deactivated (${r.reason})`);
                    } catch (e2: any) {
                        failed.push(`${nameOf(id)}: ${e2.message}`);
                    }
                } else {
                    failed.push(`${nameOf(id)}: ${e.message}`);
                }
            }
        }
        setSelectedContactIds(new Set());
        setBulkDeleteModal(false);
        if (selectedContact && ids.includes(selectedContact.id)) setSelectedContact(null);
        await loadData();
        const lines = [`Deleted ${deleted} of ${ids.length}.`];
        if (retired.length) lines.push('', 'Kept and deactivated:', ...retired.map(r => '• ' + r));
        if (failed.length) lines.push('', 'Not deleted:', ...failed.map(r => '• ' + r));
        showModal(
            deleted === ids.length ? 'Delete Complete' : 'Delete Finished With Exceptions',
            lines.join('\n'),
            failed.length ? 'danger' : deleted === ids.length ? 'success' : 'warning');
    };

    return (
        <div className={`flex flex-col h-full gap-4 w-full ${viewMode === 'directory' && !selectedContact ? 'ers-page-record' : ''}`}>
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
                                    type="button"
                                    onClick={() => setFilterSheetOpen(true)}
                                    className={`xl:hidden relative p-2 border rounded-lg transition ${activeFilterCount ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                                    title="Filters"
                                    aria-label="Filters"
                                >
                                    <Filter size={16} />
                                    {activeFilterCount > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>
                                    )}
                                </button>
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

                        <div className="flex-1 flex min-h-0">
                        {/* Filter rail — hidden once a person is open so the split view has the width */}
                        {!selectedContact && (
                            <aside className="hidden xl:flex w-52 flex-shrink-0 flex-col border-r border-slate-100 bg-slate-50/50 p-3 overflow-y-auto" aria-label="Directory filters">
                                {filterControls}
                            </aside>
                        )}
                        {/* Main Content Area */}
                        <div className="flex-1 overflow-auto table-responsive">
                            {/* Bulk Action Bar */}
                            {selectedContactIds.size > 0 && (
                                <div className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 animate-in slide-in-from-top duration-200">
                                    <div className="flex items-center gap-2">
                                        <CheckSquare size={16} className="text-white/80" />
                                        <span className="text-sm font-semibold text-white">{selectedContactIds.size} person{selectedContactIds.size > 1 ? 's' : ''} selected</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={() => setSelectedContactIds(new Set())}
                                            className="px-3 py-1 text-xs font-medium text-white/90 bg-white/15 hover:bg-white/25 rounded-md transition"
                                        >
                                            Clear
                                        </button>
                                        {(() => {
                                            const sel = filteredContacts.filter(c => selectedContactIds.has(c.id));
                                            const anyOn = sel.some(c => personState(c) !== 'inactive');
                                            const anyOff = sel.some(c => personState(c) !== 'active');
                                            const btn = `px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition ${!isAdmin ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-white/90 text-blue-800 hover:bg-white shadow-sm'}`;
                                            const tip = isAdmin ? undefined : 'Only an administrator can change this';
                                            return (
                                                <>
                                                    {anyOff && (
                                                        <button
                                                            onClick={() => setActivationModal({ ids: sel.filter(c => personState(c) !== 'active').map(c => c.id), active: true })}
                                                            disabled={!isAdmin}
                                                            className={btn}
                                                            title={tip || 'Reactivate selected'}
                                                        >
                                                            <UserCheck size={13} /> Reactivate
                                                        </button>
                                                    )}
                                                    {anyOn && (
                                                        <button
                                                            onClick={() => setActivationModal({ ids: sel.filter(c => personState(c) !== 'inactive').map(c => c.id), active: false })}
                                                            disabled={!isAdmin}
                                                            className={btn}
                                                            title={tip || 'Deactivate selected'}
                                                        >
                                                            <UserX size={13} /> Deactivate
                                                        </button>
                                                    )}
                                                </>
                                            );
                                        })()}
                                        <button
                                            onClick={() => setBulkDeleteModal(true)}
                                            disabled={!canDelete || !isAdmin}
                                            className={`px-3 py-1 text-xs font-bold rounded-md flex items-center gap-1.5 transition ${!canDelete || !isAdmin ? 'bg-white/10 text-white/40 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600 shadow-sm'}`}
                                            title={!canDelete || !isAdmin ? 'Only an administrator can delete people' : 'Delete selected'}
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
                                            {contact.image ? <StorageImage value={contact.image} alt="" className="h-full w-full object-cover" fallback={<>{contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?'}</>} /> : (contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?')}
                                        </div>
                                        <div className="mobile-card-contact-body">
                                            <div className="mobile-card-contact-name">{contact.name}</div>
                                            <div className="mobile-card-contact-sub">
                                                {contact.types.map(t => getContactTypeLabel(t)).join(', ')} {contact.email ? `· ${contact.email}` : ''}
                                            </div>
                                        </div>
                                        <div className="mobile-card-contact-badge">
                                            {(() => {
                                                const st = personState(contact);
                                                const dot = st === 'active' ? 'bg-green-500' : st === 'login_disabled' ? 'bg-amber-400' : 'bg-red-400';
                                                return <span className={`w-2.5 h-2.5 rounded-full inline-block ${dot}`} title={PERSON_STATE_LABEL[st]} aria-label={PERSON_STATE_LABEL[st]}></span>;
                                            })()}
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
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Name / Code</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                                        {!selectedContact && (
                                            <>
                                                <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Access</th>
                                                <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-20">Status</th>
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
                                                    <td className="px-4 py-4 whitespace-nowrap">
                                                        <div className="flex items-center">
                                                            <div className={"flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center font-bold overflow-hidden " + (contact.flags?.isVirtual ? "bg-orange-100 text-orange-600" : "bg-slate-200 text-slate-500")}>
                                                                {contact.image ? <StorageImage value={contact.image} alt="" className="h-full w-full object-cover" fallback={<>{contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?'}</>} /> : (contact.firstName?.charAt(0) || contact.name?.charAt(0) || '?')}
                                                            </div>
                                                            <div className="ml-3 min-w-0">
                                                                <div className="text-sm font-medium text-slate-900 truncate max-w-[210px]" title={contact.name}>{contact.name}</div>
                                                                <div className="text-xs text-slate-500 truncate max-w-[210px]">{contact.code}</div>
                                                                {contact.email && (
                                                                    <div className="text-xs text-slate-400 truncate max-w-[210px]" title={contact.email}>{contact.email}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-4 whitespace-nowrap">
                                                        <div className="flex flex-wrap gap-1 max-w-[170px]">
                                                            {contact.types.map(t => (
                                                                <span key={t} className="px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-800 border border-slate-200">
                                                                    {getContactTypeLabel(t)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-1 truncate max-w-[170px]">{contact.title}</div>
                                                    </td>
                                                    {!selectedContact && (
                                                        <>
                                                            <td className="px-3 py-4 whitespace-nowrap text-center">
                                                                {systemUser ? (
                                                                    <div className="flex flex-col items-center">
                                                                        {((systemUser.status ?? 'active') === 'active') ? (
                                                                            <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 border border-green-200 gap-1 items-center">
                                                                                <UserIcon size={12} /> Yes
                                                                            </span>
                                                                        ) : (
                                                                            <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-50 text-amber-800 border border-amber-200 gap-1 items-center" title="This login cannot sign in">
                                                                                <Lock size={12} /> Disabled
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[10px] text-slate-400 mt-1 font-mono truncate max-w-[90px]">@{systemUser.username}</span>
                                                                    </div>
                                                                ) : (
                                                                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                                                                        No Access
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-4 whitespace-nowrap text-center">
                                                                {(() => {
                                                                    const st = personState(contact);
                                                                    const cls = st === 'active' ? 'text-slate-500'
                                                                        : st === 'login_disabled' ? 'text-amber-700 font-semibold'
                                                                        : 'text-red-600 font-bold';
                                                                    return <span className={`text-xs ${cls}`}>{PERSON_STATE_LABEL[st]}</span>;
                                                                })()}
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
                        </div>

                        {/* Filters as a sheet below lg */}
                        <Drawer open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filters" width="md">
                            <div className="p-4">{filterControls}</div>
                        </Drawer>

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
                            confirmText={modalConfig.confirmText}
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
                                            <StorageImage value={selectedContact.image} alt="" className="h-full w-full object-cover" />
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
                                        { label: 'Create Profile', icon: <UserPlus size={14} />, onClick: () => setIsAddModalOpen(true), variant: 'primary' as const, disabled: !isAdmin, tooltip: isAdmin ? undefined : 'Linking a login to a person needs an administrator' },
                                        ...activationActions(),
                                    ] : [
                                        { label: 'New', icon: <Plus size={14} />, onClick: () => setIsAddModalOpen(true), variant: 'ghost' as const, disabled: !canCreate },
                                        { label: 'Duplicate', icon: <Edit2 size={14} />, onClick: handleDuplicate, variant: 'ghost' as const, disabled: !canCreate },
                                        ...activationActions(),
                                        { label: 'Delete', icon: <Trash2 size={14} />, onClick: () => handleDeleteClick(selectedContact), variant: 'danger' as const, disabled: !canDelete || !isAdmin, tooltip: isAdmin ? undefined : 'Only an administrator can delete people' },
                                        {
                                            label: 'Save',
                                            icon: <Save size={14} />,
                                            disabled: !canEdit,
                                            onClick: async () => {
                                                setLoading(true);
                                                try {
                                                    const db = DatabaseService.getInstance();
                                                    await db.updateContact(selectedContact);
                                                    // The role on this panel is also the login's access
                                                    // (users.roles, what AuthContext reads). It used to
                                                    // change only contacts.roles, so access never moved.
                                                    const li = loginInfo(selectedContact);
                                                    const login: any = li.userId ? users.find(u => u.id === li.userId) : undefined;
                                                    const roles = selectedContact.types || [];
                                                    let note = '';
                                                    if (login && isAdmin && JSON.stringify(login.roles || []) !== JSON.stringify(roles)) {
                                                        await db.updateUser(login.id, { roles } as any);
                                                        note = ' Their sign-in access now follows the new role.';
                                                    }
                                                    await loadData();
                                                    showModal('Success', 'Saved.' + note, 'success');
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
                                            roleLocked={loginInfo(selectedContact).hasLogin && !isAdmin}
                                            loginEmail={(users.find(u => u.id === loginInfo(selectedContact).userId) as any)?.email}
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
            {/* Deactivate / Reactivate Confirmation */}
            <ConfirmationModal
                isOpen={!!activationModal}
                onClose={() => setActivationModal(null)}
                onConfirm={() => activationModal && handleSetActive(activationModal.ids, activationModal.active)}
                title={activationModal?.active
                    ? `Reactivate ${activationModal.ids.length === 1 ? (mergedContacts.find(c => c.id === activationModal.ids[0])?.name || 'this person') : `${activationModal.ids.length} people`}?`
                    : `Deactivate ${activationModal && activationModal.ids.length === 1 ? (mergedContacts.find(c => c.id === activationModal.ids[0])?.name || 'this person') : `${activationModal?.ids.length ?? 0} people`}?`}
                message={activationModal?.active
                    ? 'They become active again, and anyone with a login can sign in.'
                    : 'They can no longer sign in, any open session ends now, and they drop out of assignment lists. Their work history, labour and records stay. You can reactivate them at any time.'}
                type={activationModal?.active ? 'info' : 'warning'}
                confirmText={activationModal?.active ? 'Reactivate' : 'Deactivate'}
            />
            {/* Bulk Delete Confirmation */}
            <ConfirmationModal
                isOpen={bulkDeleteModal}
                onClose={() => setBulkDeleteModal(false)}
                onConfirm={handleBulkDeleteContacts}
                title="Delete Selected People?"
                message={`You are about to permanently delete ${selectedContactIds.size} ${selectedContactIds.size === 1 ? 'person' : 'people'} and their logins. Anyone with records (work orders, labour, qualifications…) cannot be deleted — they are deactivated instead, and their history stays. This cannot be undone.`}
                type="danger"
                confirmText={`Delete ${selectedContactIds.size} Person${selectedContactIds.size > 1 ? 's' : ''}`}
            />
        </div>
    );
};

// --- Sub-Components moved to ContactsTabs.tsx ---

