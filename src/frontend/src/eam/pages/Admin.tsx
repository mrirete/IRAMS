
import React, { useState, useMemo } from 'react';
import {
    Search, Plus, Edit2, Trash2, Settings, Database, Shield, ShieldOff, Activity,
    X as XIcon, Users, Save, AlertCircle, User as UserIcon, UserPlus,
    Globe, MapPin, Briefcase, Bell, BookOpen, AlertTriangle, DollarSign, Layers, Eye, EyeOff
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
    MOCK_DICTIONARIES, DICTIONARY_TYPES, MOCK_CONTACTS, MOCK_ASSETS
} from '../constants';
import {
    DictionaryType, DictionaryEntry, PermissionSet, ModuleName, ModulePermissions, User, Contact
} from '../types';
import { ROLE_PERMISSION_TEMPLATES } from '../constants/rolePermissions';
import { DatabaseService } from '../services/DatabaseService';
import { FinOpsService, CostCenter } from '../services/FinOpsService';
import { NotificationConfig } from '../components/NotificationConfig';
import { db } from '../firebaseConfig';
import { supabase } from '../lib/supabase';
import { onSnapshot, collection } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

import { TaskLibraryManager } from './admin/TaskLibrary';
import { OrgTreePicker } from '../components/OrgTreePicker';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';

// --- Types for Local Component State ---
type AdminTab = 'dictionaries' | 'users' | 'permissions' | 'notifications' | 'settings' | 'libraries';

// --- Components ---

interface DictionaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (entry: Partial<DictionaryEntry>) => Promise<void>;
    entry?: DictionaryEntry; // If provided, we are editing
    type: DictionaryType;
    dictionaries: DictionaryEntry[]; // All dictionaries for category reference lookup
}

const DictionaryModal: React.FC<DictionaryModalProps> = ({ isOpen, onClose, onSave, entry, type, dictionaries }) => {
    const [code, setCode] = useState(entry?.code || '');
    const { showToast } = useToast();
    const [description, setDescription] = useState(entry?.description || '');
    const [hourlyRate, setHourlyRate] = useState<string>(entry?.hourlyRate?.toString() || '');
    const [suppression, setSuppression] = useState<string>(entry?.suppression?.toString() || '');
    const [categoryRef, setCategoryRef] = useState<string>(entry?.categoryRef || '');
    // Priority fields
    const [colorCode, setColorCode] = useState<string>(entry?.colorCode || '#3B82F6');
    const [sequence, setSequence] = useState<string>(entry?.sequence?.toString() || '');
    // Cost Center Fields
    const [costCenterType, setCostCenterType] = useState<string>((entry?.properties as any)?.costCenterType || 'MAINTENANCE');
    const [companyCode, setCompanyCode] = useState<string>((entry?.properties as any)?.companyCode || '');
    const [controllingArea, setControllingArea] = useState<string>((entry?.properties as any)?.controllingArea || '');
    const [validFrom, setValidFrom] = useState<string>((entry?.properties as any)?.validFrom || '');
    const [validTo, setValidTo] = useState<string>((entry?.properties as any)?.validTo || '');
    const [active, setActive] = useState(entry?.active ?? true);


    const [isSaving, setIsSaving] = useState(false);

    // Determine parent type for ISO 14224 hierarchy: Category → Class → Type
    const parentType = type === 'ASSET_CLASS' ? 'ASSET_CATEGORY' : type === 'ASSET_TYPE' ? 'ASSET_CLASS' : null;
    const parentOptions = parentType ? dictionaries.filter(d => d.type === parentType && d.active) : [];
    const costCenterTypeOptions = dictionaries.filter(d => d.type === 'COST_CENTER_TYPE' && d.active);

    // Reset when entry changes
    React.useEffect(() => {
        if (isOpen) {
            setCode(entry?.code || '');
            setDescription(entry?.description || '');
            setHourlyRate(entry?.hourlyRate?.toString() || '');
            setSuppression(entry?.suppression?.toString() || '');
            setCategoryRef(entry?.categoryRef || '');
            setColorCode(entry?.colorCode || '#3B82F6');
            setSequence(entry?.sequence?.toString() || '');
            // CC
            setCostCenterType((entry?.properties as any)?.costCenterType || 'MAINTENANCE');
            setCompanyCode((entry?.properties as any)?.companyCode || '');
            setControllingArea((entry?.properties as any)?.controllingArea || '');
            setValidFrom((entry?.properties as any)?.validFrom || '');
            setValidTo((entry?.properties as any)?.validTo || '');
            setActive(entry?.active ?? true);
        }
    }, [isOpen, entry]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const updates: any = {
                code: code.toUpperCase(),
                description,
                type,
                // Only include extended fields if relevant to type
                hourlyRate: type === 'CONTACT_TYPE' && hourlyRate ? parseFloat(hourlyRate) : undefined,
                suppression: type === 'READING_TYPE' && suppression ? parseFloat(suppression) : undefined,
                categoryRef: parentType && categoryRef ? categoryRef : undefined,
                colorCode: type === 'PRIORITY' ? colorCode : undefined,
                sequence: type === 'PRIORITY' && sequence ? parseInt(sequence) : undefined,
                properties: {
                    ...(entry?.properties || {}),
                    costCenterType: type === 'COST_CENTRE' ? costCenterType : undefined,
                    companyCode: type === 'COST_CENTRE' ? companyCode : undefined,
                    controllingArea: type === 'COST_CENTRE' ? controllingArea : undefined,
                    validFrom: type === 'COST_CENTRE' ? validFrom : undefined,
                    validTo: type === 'COST_CENTRE' ? validTo : undefined,
                },
                active // Include active status in updates
            };
            await onSave(updates);
            onClose();
        } catch (err: any) {
            showToast('Error saving: ' + err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const isLocked = entry?.is_locked || entry?.locked;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">{entry ? `Edit ${code}` : `Add New ${type.replace('_', ' ')}`}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><XIcon size={20} /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Code</label>
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="w-full p-2 border border-slate-300 rounded text-sm font-mono uppercase bg-slate-50"
                            placeholder="e.g. ELEC"
                            required
                        />
                        {!!entry && <p className="text-[10px] text-orange-500 mt-1 flex items-center gap-1"><AlertCircle size={10} /> Warning: Changing this code will NOT update existing records using it.</p>}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            disabled={isLocked && type !== 'CONTACT_TYPE'} // Locked items usually only allow description edits if soft-locked, but strict lock prevents all. Let's allow description edit for now unless strictly business logic says otherwise.
                            // Actually, let's follow the previous logic: "Locked => Only description can be updated"
                            // But wait, if safe strict lock, even description might be sensitive? No, usually description is safe.
                            className="w-full p-2 border border-slate-300 rounded text-sm"
                            placeholder="e.g. Electrical Technician"
                            required
                        />
                    </div>

                    <div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="active_toggle"
                                checked={active}
                                onChange={e => setActive(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300"
                            />
                            <label htmlFor="active_toggle" className="text-sm font-medium text-slate-700">Active</label>
                        </div>
                    </div>

                    {/* Priority Color & Sort Order */}
                    {type === 'PRIORITY' && (
                        <div className="space-y-3 p-3 bg-amber-50/50 rounded border border-amber-100">
                            <div className="text-[10px] font-bold text-amber-700 uppercase">Priority Styling</div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Color Code</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="color"
                                            value={colorCode}
                                            onChange={(e) => setColorCode(e.target.value)}
                                            className="w-10 h-10 rounded border border-slate-300 cursor-pointer"
                                            title="Pick priority color"
                                        />
                                        <input
                                            type="text"
                                            value={colorCode}
                                            onChange={(e) => setColorCode(e.target.value)}
                                            className="flex-1 p-2 border border-slate-300 rounded text-sm font-mono uppercase"
                                            placeholder="#3B82F6"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sort Order</label>
                                    <input
                                        type="number"
                                        value={sequence}
                                        onChange={(e) => setSequence(e.target.value)}
                                        className="w-full p-2 border border-slate-300 rounded text-sm font-mono"
                                        placeholder="1"
                                        min="1"
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">Lower = higher criticality (P1=1, P5=5)</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Extended Fields */}
                    {type === 'CONTACT_TYPE' && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hourly Rate ($)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={hourlyRate}
                                onChange={(e) => setHourlyRate(e.target.value)}
                                className="w-full p-2 border border-slate-300 rounded text-sm font-mono"
                                placeholder="0.00"
                            />
                        </div>
                    )}

                    {type === 'READING_TYPE' && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Suppression (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={suppression}
                                onChange={(e) => setSuppression(e.target.value)}
                                className="w-full p-2 border border-slate-300 rounded text-sm font-mono"
                                placeholder="0.00"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Don't trigger new work if within this % of last reading.</p>
                        </div>
                    )}

                    {/* Cost Center Fields */}
                    {type === 'COST_CENTRE' && (
                        <div className="space-y-3 p-3 bg-slate-50 rounded border border-slate-100">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company Code</label>
                                    <input type="text" value={companyCode} onChange={e => setCompanyCode(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm" placeholder="e.g. 1000" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                    <select value={costCenterType} onChange={e => setCostCenterType(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm bg-white">
                                        <option value="MAINTENANCE">Maintenance</option>
                                        {costCenterTypeOptions.map(opt => (
                                            <option key={opt.id} value={opt.code}>{opt.description}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valid From</label>
                                    <input type="date" value={validFrom ? validFrom.split('T')[0] : ''} onChange={e => setValidFrom(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valid To</label>
                                    <input type="date" value={validTo ? validTo.split('T')[0] : ''} onChange={e => setValidTo(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Classification Hierarchy - Category Reference */}
                    {parentType && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                {type === 'ASSET_CLASS' ? 'Parent Category' : 'Parent Class'}
                            </label>
                            <select
                                value={categoryRef}
                                onChange={(e) => setCategoryRef(e.target.value)}
                                className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                            >
                                <option value="">Select {type === 'ASSET_CLASS' ? 'Category' : 'Class'}...</option>
                                {parentOptions.map(opt => (
                                    <option key={opt.id} value={opt.code}>{opt.description} ({opt.code})</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-400 mt-1">
                                Links this {type === 'ASSET_CLASS' ? 'class' : 'type'} to a parent {type === 'ASSET_CLASS' ? 'category' : 'class'} for cascading selection (ISO 14224).
                            </p>
                        </div>
                    )}

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="px-4 py-2 text-sm font-medium text-white bg-relantern-500 hover:bg-relantern-600 rounded-lg flex items-center gap-2"
                        >
                            {isSaving ? <Activity className="animate-spin" size={16} /> : <Save size={16} />}
                            {entry ? 'Save Changes' : 'Create Entry'}
                        </button>
                    </div>
                </form>
            </div >
        </div >
    );
};

const ADMIN_MODULES: { key: ModuleName; label: string; tier?: string }[] = [
    { key: 'dashboard', label: 'Dashboard', tier: 'core' },
    { key: 'assets', label: 'Assets', tier: 'core' },
    { key: 'requests', label: 'Work Requests', tier: 'core' },
    { key: 'workOrders', label: 'Work Orders', tier: 'core' },
    { key: 'pm', label: 'Recurring Work', tier: 'core' },
    { key: 'scheduling', label: 'Scheduling', tier: 'core' },
    { key: 'inventory', label: 'Inventory', tier: 'core' },
    { key: 'purchasing', label: 'Purchasing', tier: 'core' },
    { key: 'readings', label: 'Condition Data', tier: 'core' },
    { key: 'analytics', label: 'Analytics', tier: 'core' },
    { key: 'contacts', label: 'People', tier: 'core' },
    { key: 'vendors', label: 'Vendors', tier: 'core' },
    { key: 'finops', label: 'FinOps', tier: 'core' },
    { key: 'taskLibrary', label: 'Task Library', tier: 'core' },
    { key: 'safety', label: 'Safety & PTW', tier: 'core' },
    { key: 'moc', label: 'Management of Change', tier: 'core' },
    { key: 'notifications', label: 'Notifications', tier: 'core' },
    { key: 'admin', label: 'Administration', tier: 'core' },
    // Premium Suite Modules
    { key: 'reliability', label: 'Reliability Suite', tier: 'reliability' },
    { key: 'integrity', label: 'Integrity Suite', tier: 'integrity' },
    { key: 'audits', label: 'Audit Suite', tier: 'audits' },
    { key: 'sustain', label: 'Sustainability Suite', tier: 'sustainability' },
];

// --- 1. Dictionaries Manager ---


const DictionaryManager: React.FC = () => {
    const navigate = useNavigate();
    const [selectedType, setSelectedType] = useState<DictionaryType>('READING_TYPE');
    const [searchTerm, setSearchTerm] = useState('');
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const { showToast } = useToast();
    const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<DictionaryEntry>>>(new Map());
    const [isSavingAll, setIsSavingAll] = useState(false);
    const [showInactive, setShowInactive] = useState(false);


    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [editingEntry, setEditingEntry] = useState<DictionaryEntry | undefined>(undefined);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; entry: DictionaryEntry | null }>({
        isOpen: false,
        entry: null
    });

    React.useEffect(() => {
        const load = async () => {
            const data = await DatabaseService.getInstance().getDictionaries();
            setDictionaries(data);
        };
        load();
    }, [selectedType]); // Re-load when type changes

    const handleDeleteClick = (entry: DictionaryEntry) => {
        if (entry.is_locked || entry.locked) {
            showToast('This entry is LOCKED and cannot be deleted.', 'warning');
            return;
        }
        setDeleteModal({ isOpen: true, entry });
    };

    const handleConfirmDelete = async () => {
        if (!deleteModal.entry) return;
        try {
            await DatabaseService.getInstance().deleteDictionary(deleteModal.entry.id);
            setDictionaries(prev => prev.filter(d => d.id !== deleteModal.entry!.id));
        } catch (e: any) {
            showToast('Error deleting: ' + e.message, 'error');
        } finally {
            setDeleteModal({ isOpen: false, entry: null });
        }
    };

    const handleEditClick = (entry: DictionaryEntry) => {
        setEditingEntry(entry);
        setShowModal(true);
    };

    const handleAddClick = () => {
        setEditingEntry(undefined);
        setShowModal(true);
    };

    const [isSeeding, setIsSeeding] = useState(false);

    const handleModalSave = async (updates: Partial<DictionaryEntry>) => {
        const db = DatabaseService.getInstance();

        if (editingEntry) {
            // Update
            await db.updateDictionary(editingEntry.id, updates);
            setDictionaries(prev => prev.map(d => d.id === editingEntry.id ? { ...d, ...updates } : d));
        } else {
            // Create
            if (!updates.code || !updates.description) throw new Error("Code and Description are required");

            const newEntry: any = {
                id: crypto.randomUUID(),
                type: selectedType,
                code: updates.code,
                description: updates.description,
                active: true,
                is_locked: false,
                updated_at: new Date().toISOString(),
                ...updates // includes hourlyRate, suppression etc
            };

            await db.addDictionary(newEntry);
            setDictionaries(prev => [...prev, newEntry]);
        }
    };

    const handleSeed = async () => {
        if (!confirm("This will populate empty dictionary tables with default values. Continue?")) return;
        setIsSeeding(true);
        const db = DatabaseService.getInstance();
        try {
            // Filter mocks for current missing types or just add all unique?
            // Since we know table is empty (or listing is empty), let's try to add all mocks.
            // Supabase 'insert' might fail on duplicates if any exist unseen.

            let count = 0;
            for (const mock of MOCK_DICTIONARIES) {
                // Check if exists in current listing? No, listing might be partial.
                // DatabaseService will throw if duplicate?
                // Let's try to add. If duplicate, we catch and ignore.
                try {
                    // We need to shape mock to DictionaryEntry if needed, but they match closely.
                    // Mock has: id, type, code, description, properties...

                    // We need to strip extra fields if MOCK has them at root vs properties?
                    // Verify MOCK structure. Assuming it matches DictionaryEntry.
                    const entry = {
                        ...mock,
                        // id: crypto.randomUUID(), // REMOVED: Let upsert handle ID or use existing mock ID
                        updated_at: new Date().toISOString()
                    };
                    await db.upsertDictionary(entry as any);
                    count++;
                } catch (e: any) {
                    console.warn(`Skipping ${mock.code}:`, e.message);
                }
            }
            // Reload
            const data = await db.getDictionaries();
            setDictionaries(data);
            showToast(`Seeding complete. Added ${count} entries.`, 'success');
        } catch (e: any) {
            showToast('Error seeding: ' + e.message, 'error');
        } finally {
            setIsSeeding(false);
        }
    };




    const entries = dictionaries.filter(d =>
        d.type === selectedType &&
        (d.code.includes(searchTerm.toUpperCase()) || d.description.toLowerCase().includes(searchTerm.toLowerCase())) &&
        (showInactive || d.active !== false) // Filter inactive unless toggle is on
    ).sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));

    const isContactType = selectedType === 'CONTACT_TYPE';
    const isReadingType = selectedType === 'READING_TYPE';
    const isPriorityType = selectedType === 'PRIORITY';

    // Inline edit handlers for priority color/sequence
    const handleInlineColorChange = (entryId: string, color: string) => {
        setDictionaries(prev => prev.map(d => d.id === entryId ? { ...d, colorCode: color } : d));
        setPendingChanges(prev => {
            const updated = new Map(prev);
            const existing = updated.get(entryId) ?? {};
            updated.set(entryId, { ...(existing as object), colorCode: color });
            return updated;
        });
    };

    const handleInlineSequenceChange = (entryId: string, seq: string) => {
        const seqNum = seq ? parseInt(seq) : undefined;
        setDictionaries(prev => prev.map(d => d.id === entryId ? { ...d, sequence: seqNum } : d));
        setPendingChanges(prev => {
            const updated = new Map(prev);
            const existing = updated.get(entryId) ?? {};
            updated.set(entryId, { ...(existing as object), sequence: seqNum });
            return updated;
        });
    };

    const handleSaveAll = async () => {
        if (pendingChanges.size === 0) {
            showToast('No changes to save.', 'info');
            return;
        }
        setIsSavingAll(true);
        const db = DatabaseService.getInstance();
        try {
            for (const [id, updates] of pendingChanges) {
                await db.updateDictionary(id, updates);
            }
            setPendingChanges(new Map());
            showToast(`Saved ${pendingChanges.size} change(s) successfully.`, 'success');
        } catch (e: any) {
            showToast('Error saving: ' + e.message, 'error');
        } finally {
            setIsSavingAll(false);
        }
    };

    return (
        <div className="flex h-full animate-in fade-in duration-300 relative">
            {showModal && (
                <DictionaryModal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    onSave={handleModalSave}
                    entry={editingEntry}
                    type={selectedType}
                    dictionaries={dictionaries}
                />
            )}

            {/* Mobile Dictionary Type Selector */}
            <div className="md:hidden p-3 border-b border-slate-200 bg-slate-50">
                <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value as DictionaryType)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white"
                >
                    {DICTIONARY_TYPES.map(type => (
                        <option key={type.key} value={type.key}>{type.label}</option>
                    ))}
                </select>
            </div>

            {/* Type List (Desktop Sidebar) */}
            <div className="hidden md:block w-64 bg-slate-50 border-r border-slate-200 overflow-y-auto">
                <div className="p-4 border-b border-slate-200">
                    <h2 className="font-bold text-slate-800 text-sm">Dictionary Types</h2>
                </div>
                {DICTIONARY_TYPES.map(type => (
                    <button
                        key={type.key}
                        onClick={() => setSelectedType(type.key as DictionaryType)}
                        className={`w-full text-left px-4 py-3 text-sm font-medium border-b border-slate-100 hover:bg-slate-100 transition-colors ${selectedType === type.key ? 'bg-white text-blue-700 border-l-4 border-l-blue-600' : 'text-slate-600'}`}
                    >
                        {type.label}
                    </button>
                ))}
            </div>

            {/* Entries List */}
            <div className="flex-1 bg-white flex flex-col p-6">
                <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{DICTIONARY_TYPES.find(t => t.key === selectedType)?.label}</h2>
                        <p className="text-sm text-slate-500">Manage standard codes for this attribute.</p>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="show_inactive"
                                checked={showInactive}
                                onChange={e => setShowInactive(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300"
                            />
                            <label htmlFor="show_inactive" className="text-xs text-slate-600">Show Inactive</label>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => window.location.reload()}
                            className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-medium transition-colors border border-slate-300 shadow-sm"
                            title="Reload Application to refresh data"
                        >
                            <Database size={14} /> Refresh App
                        </button>

                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search codes..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                            />
                        </div>
                        <button
                            onClick={handleAddClick}
                            className="flex items-center gap-2 px-4 py-2 bg-relantern-500 text-white rounded-lg hover:bg-relantern-600 text-sm font-medium transition-colors shadow-sm">
                            <Plus size={16} /> Add Entry
                        </button>

                        {isPriorityType && pendingChanges.size > 0 && (
                            <button
                                onClick={handleSaveAll}
                                disabled={isSavingAll}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-bold transition-colors shadow-sm animate-in fade-in slide-in-from-right-2"
                            >
                                {isSavingAll ? <Activity className="animate-spin" size={16} /> : <Save size={16} />}
                                Save All Changes ({pendingChanges.size})
                            </button>
                        )}

                    </div>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-y-auto overflow-x-auto flex-1 flex flex-col max-h-[calc(100vh-280px)]">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Code</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Description</th>
                                {isContactType && (
                                    <>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Hourly Rate ($)</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Manufacturer?</th>
                                    </>
                                )}
                                {isReadingType && (
                                    <>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Category Code</th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Suppression</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Locked</th>
                                    </>
                                )}
                                {isPriorityType && (
                                    <>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Color</th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Sort Order</th>
                                    </>
                                )}
                                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                                <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                            {entries.map(entry => (
                                <tr key={entry.id} className="hover:bg-slate-50">
                                    <td className="px-6 py-4 text-sm font-mono font-medium text-slate-900">
                                        {isPriorityType && entry.colorCode && (
                                            <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle" style={{ backgroundColor: entry.colorCode }}></span>
                                        )}
                                        {entry.code}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{entry.description}</td>
                                    {isContactType && (
                                        <>
                                            <td className="px-6 py-4 text-sm text-right text-slate-900 font-medium">
                                                {entry.hourlyRate ? `$${entry.hourlyRate.toFixed(2)}` : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {entry.isManufacturer ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                        Yes
                                                    </span>
                                                ) : <span className="text-slate-300">-</span>}
                                            </td>
                                        </>
                                    )}
                                    {isReadingType && (
                                        <>
                                            <td className="px-6 py-4 text-sm text-slate-600">
                                                {entry.categoryCode || '-'}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right text-slate-900 font-medium">
                                                {entry.suppression !== undefined ? `${entry.suppression.toFixed(2)}%` : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={!!(entry.is_locked || entry.locked)}
                                                    readOnly
                                                    className="w-4 h-4 rounded text-blue-600 bg-slate-100 border-slate-300 cursor-not-allowed"
                                                />
                                            </td>

                                        </>
                                    )}
                                    {isPriorityType && (
                                        <>
                                            <td className="px-6 py-4 text-center">
                                                <input
                                                    type="color"
                                                    value={entry.colorCode || '#3B82F6'}
                                                    onChange={(e) => handleInlineColorChange(entry.id, e.target.value)}
                                                    className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                                                    title={`Color: ${entry.colorCode || 'Default'}`}
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <input
                                                    type="number"
                                                    value={entry.sequence ?? ''}
                                                    onChange={(e) => handleInlineSequenceChange(entry.id, e.target.value)}
                                                    className="w-16 p-1 border border-slate-300 rounded text-sm text-center font-mono"
                                                    min="1"
                                                />
                                            </td>
                                        </>
                                    )}
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${entry.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                                {entry.active ? 'Active' : 'Inactive'}
                                            </span>
                                            {(entry.is_locked || entry.locked) && (
                                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 flex items-center gap-1">
                                                    <Shield size={10} /> Locked
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                                        {selectedType === 'COST_CENTRE' && (
                                            <button onClick={() => navigate(`/finops?tab=cost-centers&id=${entry.id}`)} className="p-1 px-2 text-green-600 hover:bg-green-50 rounded flex items-center gap-1 text-xs font-medium border border-transparent hover:border-green-200 transition-colors" title="Manage Budget">
                                                <DollarSign size={14} /> Budget
                                            </button>
                                        )}
                                        {(entry.is_locked || entry.locked) ? (
                                            <button
                                                onClick={async () => {
                                                    if (!confirm(`Unlock "${entry.code}"? This will allow editing and deletion of this entry.`)) return;
                                                    try {
                                                        await DatabaseService.getInstance().updateDictionary(entry.id, { is_locked: false, locked: false });
                                                        setDictionaries(prev => prev.map(d => d.id === entry.id ? { ...d, is_locked: false, locked: false } : d));
                                                    } catch (e: any) { showToast('Error unlocking: ' + e.message, 'error'); }
                                                }}
                                                className="p-1 text-amber-500 hover:text-amber-700 transition-colors"
                                                title="Unlock this entry"
                                            ><ShieldOff size={16} /></button>
                                        ) : (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await DatabaseService.getInstance().updateDictionary(entry.id, { is_locked: true, locked: true });
                                                        setDictionaries(prev => prev.map(d => d.id === entry.id ? { ...d, is_locked: true, locked: true } : d));
                                                    } catch (e: any) { showToast('Error locking: ' + e.message, 'error'); }
                                                }}
                                                className="p-1 text-slate-300 hover:text-amber-500 transition-colors"
                                                title="Lock this entry"
                                            ><Shield size={16} /></button>
                                        )}
                                        <button onClick={() => handleEditClick(entry)} className="p-1 text-slate-400 hover:text-blue-600 transition-colors"><Edit2 size={16} /></button>
                                        <button onClick={() => handleDeleteClick(entry)} className="p-1 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                                    </td>


                                </tr>
                            ))}
                            {entries.length === 0 && (
                                <tr>
                                    <td colSpan={isContactType || isReadingType ? 6 : 4} className="px-6 py-12 text-center text-slate-400 text-sm">
                                        <div className="flex flex-col items-center gap-4">
                                            <p>No entries found. Click "Add Entry" to create one.</p>
                                            <p className="text-xs">Or initialize with standard defaults:</p>
                                            <button
                                                onClick={handleSeed}
                                                disabled={isSeeding}
                                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium flex items-center gap-2 border border-slate-300 transition-colors"
                                            >
                                                {isSeeding ? <Activity className="animate-spin text-blue-600" size={16} /> : <Database size={16} />}
                                                {isSeeding ? 'Seeding Database...' : 'Seed Default Dictionaries'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, entry: null })}
                onConfirm={handleConfirmDelete}
                title="Delete Dictionary Entry?"
                message={`Are you sure you want to delete '${deleteModal.entry?.code}'? This change will be permanent.`}
                type="danger"
                confirmText="Delete Entry"
            />
        </div >
    );
};

// --- 2. User Permission Manager (Replaces Permission Sets) ---

const UserPermissionManager: React.FC = () => {
    // We track selection by a unique ID (User ID if exists, otherwise Contact ID)
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { showToast } = useToast();
    const [users, setUsers] = useState<User[]>([]); // Local state for edits
    const [contacts, setContacts] = useState<Contact[]>([]); // Local state for roles
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);
    const [assets, setAssets] = useState<any[]>([]); // Using any for Asset to avoid import issues if Asset type isn't fully imported or compatible
    const [orgUnits, setOrgUnits] = useState<any[]>([]); // Org Units
    const [activeTab, setActiveTab] = useState<'assignments' | 'matrix' | 'moduleAccess'>('assignments');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Load Data
    React.useEffect(() => {
        const load = async () => {
            const db = DatabaseService.getInstance();
            try {
                const [dbUsers, dbContacts, dbDictionaries, dbAssets, dbOrgUnits] = await Promise.all([
                    db.getUsers(),
                    db.getContacts(),
                    db.getDictionaries(),
                    db.getAssets(),
                    db.getOrgUnits()
                ]);
                // Handle potential Schema vs Seed Data mismatch (contactId vs contact_id)
                // The 'migrated' data uses camelCase from constants.ts, but Schema expects snake_case.
                setUsers(dbUsers.map(u => ({
                    ...u,
                    // @ts-ignore - Runtime check for property name
                    contactId: u.contactId || u.contact_id,
                    mfaEnabled: u.mfaEnabled || false
                }) as User));
                setContacts(dbContacts);
                setDictionaries(dbDictionaries);
                setAssets(dbAssets);
                setOrgUnits(dbOrgUnits);
            } catch (error) {
                console.error("Failed to load admin data", error);
            }
        };
        load();
    }, []);

    // Derived Data
    const roles = useMemo(() => {
        const all = dictionaries.filter(d => d.type === 'CONTACT_TYPE');
        // Deduplicate by Description (keep first)
        const seen = new Set<string>();
        return all.filter(r => {
            const key = (r.description || r.code).toLowerCase().trim();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [dictionaries]);
    const sites = useMemo(() => assets.filter(a => a.category === 'Site' || a.category === 'Area'), [assets]);

    // Derived Data: Merge Users and Contacts into "Identities"
    type Identity = {
        id: string; // user.id OR contact.id (if no user)
        type: 'USER' | 'CONTACT_ONLY';
        user?: User;
        contact?: Contact;
        name: string;
        subtext: string;
        initials: string;
    };

    const identities: Identity[] = useMemo(() => {
        const list: Identity[] = [];

        // 1. Process All Users
        users.forEach(u => {
            const c = contacts.find(contact => contact.id === u.contactId);
            list.push({
                id: u.id,
                type: 'USER',
                user: u,
                contact: c,
                name: c?.name || u.username,
                subtext: c ? (roles.find(r => r.code === c.defaultType)?.description || 'Unassigned') : u.username,
                initials: (c?.name || u.username).substring(0, 2).toUpperCase()
            });
        });

        // 2. Process Contacts causing "No Access" (i.e. those NOT linked to any user)
        contacts.forEach(c => {
            // Check if this contact is already linked to a user
            const isLinked = users.some(u => u.contactId === c.id);
            if (!isLinked) {
                list.push({
                    id: c.id,
                    type: 'CONTACT_ONLY',
                    contact: c,
                    name: c.name,
                    subtext: 'No System Access',
                    initials: c.name.substring(0, 2).toUpperCase()
                });
            }
        });

        // Sort by name
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }, [users, contacts, roles]);

    const selectedIdentity = useMemo(() => identities.find(i => i.id === selectedId), [identities, selectedId]);

    // For existing logic compat:
    const selectedUser = selectedIdentity?.user;
    const linkedContact = selectedIdentity?.contact;

    // Calculate Effective Permissions: Union of All Roles + User Overrides
    const effectivePermissions = useMemo(() => {
        if (!linkedContact) return {};

        // 1. Check for System Admin (Full overrides)
        // Match by code OR by description containing "System Admin"
        const assignedRoleCodes = linkedContact.types || [];
        const assignedRoleObjects = roles.filter(r => assignedRoleCodes.includes(r.code));

        const isSysAdmin = assignedRoleCodes.some(code =>
            (code.toUpperCase().includes('SYS') && code.toUpperCase().includes('ADMIN')) ||
            code.toUpperCase() === 'ADMIN' ||
            code.toUpperCase() === 'SYS_ADMIN' ||
            code.toUpperCase() === 'SUPER_ADMIN'
        ) || assignedRoleObjects.some(role =>
            role.description?.toLowerCase().includes('system admin') ||
            role.description?.toLowerCase().includes('administrator') ||
            role.description?.toLowerCase().includes('super admin')
        );

        let aggregatedBase: Record<string, ModulePermissions> = {};

        if (isSysAdmin) {
            const allModules = ADMIN_MODULES.map(m => m.key);
            const FULL_ACCESS_VAL: ModulePermissions = {
                view: true, create: true, edit: true, delete: true,
                approve: true, authorize: true, viewCosts: true, assign: true, spendingLimit: 1000000
            };
            allModules.forEach(mod => { aggregatedBase[mod] = FULL_ACCESS_VAL; });
        } else {
            // 2. Aggregate Base Permissions from ALL assigned roles
            // IMPORTANT: Must match AuthContext resolution order:
            //   a) ROLE_PERMISSION_TEMPLATES (hardcoded, version-controlled — PRIMARY)
            //   b) DB reference_codes.permissions (for custom/dynamic roles — FALLBACK)
            // This ensures the Admin panel shows the SAME effective state the user's session uses.
            const assignedRoleCodes = linkedContact.types || [];

            // Get all unique modules from all roles (using templates first, then DB fallback)
            const allRoleModules = new Set<string>();
            assignedRoleCodes.forEach(roleCode => {
                // PRIMARY: Check ROLE_PERMISSION_TEMPLATES (matches AuthContext)
                const templatePerms = ROLE_PERMISSION_TEMPLATES[roleCode];
                if (templatePerms) {
                    Object.keys(templatePerms).forEach(k => allRoleModules.add(k));
                } else {
                    // FALLBACK: Check DB-loaded role objects
                    const dbRole = roles.find(r => r.code === roleCode);
                    if (dbRole?.permissions) {
                        Object.keys(dbRole.permissions).forEach(k => allRoleModules.add(k));
                    }
                }
            });

            allRoleModules.forEach(modKey => {
                const mod = modKey as ModuleName;
                let combined: ModulePermissions = {
                    view: false, create: false, edit: false, delete: false,
                    approve: false, authorize: false, assign: false, viewCosts: false, spendingLimit: 0
                };

                assignedRoleCodes.forEach(roleCode => {
                    // PRIMARY: ROLE_PERMISSION_TEMPLATES
                    const templatePerms = ROLE_PERMISSION_TEMPLATES[roleCode];
                    const p = templatePerms?.[mod] ||
                        roles.find(r => r.code === roleCode)?.permissions?.[mod];
                    if (p) {
                        combined.view = combined.view || p.view;
                        combined.create = combined.create || p.create;
                        combined.edit = combined.edit || p.edit;
                        combined.delete = combined.delete || p.delete;
                        combined.approve = combined.approve || p.approve;
                        combined.authorize = combined.authorize || p.authorize;
                        combined.assign = combined.assign || p.assign;
                        combined.viewCosts = combined.viewCosts || p.viewCosts;
                        combined.spendingLimit = Math.max(combined.spendingLimit || 0, p.spendingLimit || 0);
                    }
                });
                aggregatedBase[mod] = combined;
            });
        }

        // 3. Apply User Overrides
        // Overrides can grant OR revoke? Use standard "override" logic:
        // Technically, "Override" usually means "Replace". But here we typically mean "Exceptions".
        // The original logic was: Base || Override (if undefined, default false).
        // Let's stick to: Result = Override !== undefined ? Override : Base.
        // BUT wait, overrides object structure in types might be partial?
        // Let's assume overrides are explicit.

        const overrides = selectedUser?.permissionOverrides || {};
        const finalPermissions: Record<string, ModulePermissions> = { ...aggregatedBase };

        // Ensure all override keys are present
        Object.keys(overrides).forEach(modKey => {
            const mod = modKey as ModuleName;
            const base = finalPermissions[mod] || { view: false, create: false, edit: false, delete: false, approve: false, authorize: false, assign: false, viewCosts: false, spendingLimit: 0 };
            const ovr = overrides[mod];

            finalPermissions[mod] = {
                ...base,
                ...ovr // This blindly applies overrides. If override has explicit 'false', it revokes.
            };
        });

        // If a module exists in defaults or dictionary but not in final, ensure it's there
        // (Handled by initial population of aggregatedBase)

        return finalPermissions;
    }, [linkedContact, roles, selectedUser]);

    const handlePermissionChange = (module: ModuleName, action: keyof ModulePermissions, value: any) => {
        if (!selectedUser) return;

        // Create new overrides object
        const newOverrides = { ...selectedUser.permissionOverrides };
        if (!newOverrides[module]) newOverrides[module] = {};

        // Set the override value
        // @ts-ignore
        newOverrides[module]![action] = value;

        // Update user state
        setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, permissionOverrides: newOverrides } : u));
    };

    // Role Management
    const handleAddRole = (roleCode: string) => {
        if (!linkedContact) return;
        if (linkedContact.types.includes(roleCode)) return;

        // ═══ GOVERNANCE GUARD: Role Elevation Protection ═══
        // Only SUPER_ADMIN can promote users to admin-tier roles.
        // This prevents SYS_ADMIN from creating "shadow admins" without oversight.
        // Per NIST 800-53 AC-6: Least Privilege / Separation of Duties.
        const ADMIN_TIER_ROLES = ['SYS_ADMIN', 'SUPER_ADMIN', 'ADMIN'];
        if (ADMIN_TIER_ROLES.includes(roleCode.toUpperCase())) {
            // Check if the CURRENT user (not the selected user) is SUPER_ADMIN
            const currentUserStr = localStorage.getItem('ers_current_user');
            const currentUserRoles: string[] = currentUserStr ? (JSON.parse(currentUserStr)?.roles || []) : [];
            const isSuperAdmin = currentUserRoles.some((r: string) => r.toUpperCase() === 'SUPER_ADMIN');

            if (!isSuperAdmin) {
                showToast('Role Elevation Blocked: Only a Super Administrator can assign System Administrator or Super Administrator roles. (NIST 800-53 AC-6)', 'error');
                return;
            }
        }

        const updatedContact = { ...linkedContact, types: [...linkedContact.types, roleCode] };
        setContacts(prev => prev.map(c => c.id === linkedContact.id ? updatedContact : c));
    };

    const handleRemoveRole = (roleCode: string) => {
        if (!linkedContact) return;
        // Prevent removing the default type
        if (roleCode === linkedContact.defaultType) return;

        const updatedContact = { ...linkedContact, types: linkedContact.types.filter(t => t !== roleCode) };
        setContacts(prev => prev.map(c => c.id === linkedContact.id ? updatedContact : c));
    };

    // Scope Management
    const toggleSite = (siteId: string) => {
        if (!selectedUser) return;
        const currentSites = selectedUser.dataScopeOverrides?.siteIds || [];
        const isAll = currentSites.includes('*');
        let newSites: string[] = [];

        if (isAll) {
            // Switching from All to Specific -> Select just this one
            newSites = [siteId];
        } else {
            if (currentSites.includes(siteId)) {
                newSites = currentSites.filter(id => id !== siteId);
            } else {
                newSites = [...currentSites, siteId];
            }
        }

        const newOverrides = { ...selectedUser.dataScopeOverrides, siteIds: newSites };
        setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, dataScopeOverrides: newOverrides } : u));
    };

    const setScopeMode = (mode: 'GLOBAL' | 'SITE_SPECIFIC') => {
        if (!selectedUser) return;
        const newSites = mode === 'GLOBAL' ? ['*'] : [];
        const newOverrides = { ...selectedUser.dataScopeOverrides, siteIds: newSites };
        setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, dataScopeOverrides: newOverrides } : u));
    };

    const toggleOwnWork = (val: boolean) => {
        if (!selectedUser) return;
        const newOverrides = { ...selectedUser.dataScopeOverrides, ownWorkOnly: val };
        setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, dataScopeOverrides: newOverrides } : u));
    };

    const handleSave = async () => {
        if (!selectedUser || !linkedContact) return;
        setIsSaving(true);
        setSaveSuccess(false);

        try {
            const dbSvc = DatabaseService.getInstance();
            await Promise.all([
                // Update User Overrides (permission_overrides + data_scope_overrides)
                // @ts-ignore
                dbSvc.updateUserPermissions(selectedUser.id, selectedUser.permissionOverrides || {}, selectedUser.dataScopeOverrides || {}),
                // Update Contact Roles
                dbSvc.updateContact({ ...linkedContact, types: linkedContact.types, defaultType: linkedContact.defaultType }),
                // ═══ CRITICAL: Sync users.roles with contact's types ═══
                // AuthContext resolves permissions from users.roles FIRST (not contacts.roles).
                // If we only update the contact, users.roles goes stale and the user
                // gets the wrong permission template at login (e.g. INTERNAL instead of SYS_ADMIN).
                dbSvc.updateUser(selectedUser.id, { roles: linkedContact.types }),
            ]);

            // Show success state
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error("Failed to save permissions", error);
            showToast('Failed to save permissions. Please check console.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const modules = ADMIN_MODULES;

    const actions: { key: keyof ModulePermissions; label: string }[] = [
        { key: 'view', label: 'View' },
        { key: 'create', label: 'Create' },
        { key: 'edit', label: 'Edit' },
        { key: 'delete', label: 'Delete' },
        { key: 'approve', label: 'Approve' },
        { key: 'authorize', label: 'Authorize' }, // New Action
        { key: 'assign', label: 'Assign' },
        { key: 'viewCosts', label: 'View Costs' },
    ];

    const isGlobalScope = selectedUser?.dataScopeOverrides?.siteIds?.includes('*');

    return (
        <div className="flex h-full animate-in fade-in duration-300">
            {/* List of Identities (Users + Contacts) */}
            <div className="w-72 bg-slate-50 border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="font-bold text-slate-800 text-sm">System Access Directory</h2>
                    <span className="text-xs bg-slate-200 px-2 py-0.5 rounded-full text-slate-600">{identities.length}</span>
                </div>
                <div className="overflow-y-auto flex-1">
                    {identities.map(identity => {
                        return (
                            <div
                                key={identity.id}
                                onClick={() => setSelectedId(identity.id)}
                                className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors flex items-center gap-3 ${selectedId === identity.id ? 'bg-white border-l-4 border-l-blue-600' : ''}`}
                            >
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${identity.type === 'USER' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
                                    {identity.initials}
                                </div>
                                <div className="overflow-hidden">
                                    <div className="font-medium text-slate-900 truncate">{identity.name}</div>
                                    <div className={`text-xs truncate ${identity.type === 'USER' ? 'text-slate-500' : 'text-orange-500 italic'}`}>
                                        {identity.subtext}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Detail Editor */}
            <div className="flex-1 flex flex-col bg-white overflow-hidden">
                {selectedIdentity ? (
                    selectedUser ? (
                        linkedContact ? (
                            <div className="flex-1 flex flex-col h-full overflow-hidden">
                                <div className="p-6 border-b border-slate-200 bg-slate-50/50 flex-shrink-0">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-lg">
                                                {linkedContact.name.charAt(0)}
                                            </div>
                                            <div>
                                                <h2 className="text-xl font-bold text-slate-900">{linkedContact.name}</h2>
                                                <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                                                    <span className="flex items-center gap-1"><UserIcon size={14} /> {selectedUser.username}</span>
                                                    <span>•</span>
                                                    <span>Primary Role: <strong>{roles.find(r => r.code === linkedContact.defaultType)?.description}</strong></span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex gap-2 items-center">
                                            {saveSuccess && (
                                                <span className="text-sm font-medium text-green-600 animate-in fade-in slide-in-from-right-2 flex items-center gap-1">
                                                    <Shield size={14} /> Saved Successfully
                                                </span>
                                            )}
                                            <button
                                                onClick={handleSave}
                                                disabled={isSaving}
                                                className={`px-4 py-2 text-white rounded text-sm font-medium flex items-center gap-2 shadow-sm transition-all ${isSaving ? 'bg-slate-400 cursor-not-allowed' : saveSuccess ? 'bg-green-600 hover:bg-green-700' : 'bg-relantern-500 hover:bg-relantern-600'}`}
                                            >
                                                <Save size={16} className={isSaving ? "animate-spin" : ""} />
                                                {isSaving ? "Saving..." : saveSuccess ? "Saved" : "Save Changes"}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* TABS - NOW STICKY/FIXED */}
                                <div className="px-6 border-b border-slate-200 bg-white flex-shrink-0 z-10">
                                <div className="flex gap-6">
                                        <button
                                            onClick={() => setActiveTab('assignments')}
                                            className={`pb-3 pt-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'assignments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Assignments & Scope
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('moduleAccess')}
                                            className={`pb-3 pt-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${activeTab === 'moduleAccess' ? 'border-amber-600 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                        >
                                            <Layers size={14} /> Module Access
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('matrix')}
                                            className={`pb-3 pt-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'matrix' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Effective Permission Matrix
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 space-y-8">



                                    {activeTab === 'assignments' && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {/* ROLES & RESPONSIBILITIES SECTION */}
                                            <section>
                                                <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                                                    <Briefcase size={16} className="text-blue-600" /> Roles & Responsibilities
                                                </h3>
                                                <div className="p-5 border border-slate-200 rounded-xl bg-white shadow-sm space-y-6">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        <div>
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Base Role (Primary)</label>
                                                            <select
                                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-medium focus:ring-2 focus:ring-relantern-500 focus:border-blue-500"
                                                                value={linkedContact.defaultType}
                                                                onChange={(e) => {
                                                                    const newRole = e.target.value;
                                                                    // Ensure the new role is also in the types array
                                                                    // Swap Base Role Logic:
                                                                    // 1. Remove the OLD base role from the list (unless it was duplicate, but we assume unique)
                                                                    // 2. Add the NEW base role
                                                                    // 3. Keep other additional roles
                                                                    const others = linkedContact.types.filter(t => t !== linkedContact.defaultType && t !== newRole);
                                                                    const newTypes = [newRole, ...others];

                                                                    // Update contact
                                                                    const updatedContact = {
                                                                        ...linkedContact,
                                                                        defaultType: newRole,
                                                                        types: newTypes
                                                                    };
                                                                    setContacts(prev => prev.map(c => c.id === linkedContact.id ? updatedContact : c));

                                                                    // If selecting SYS_ADMIN, we might want to prevent overrides or force them to all true?
                                                                    // The effectivePermissions logic matches base role, so if SYS_ADMIN has all true, it works.
                                                                    // But we should probably clear manual overrides if switching TO Sys Admin to avoid confusion?
                                                                    // For now, simple base switch is enough as merging takes base permissions as baseline.
                                                                }}
                                                            >
                                                                {roles.map(r => <option key={r.id} value={r.code}>{r.description}</option>)}
                                                            </select>
                                                            <p className="text-xs text-slate-400 mt-1">Defines the default permission baseline.</p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Additional Roles (Multi-Role)</label>
                                                            <div className="flex flex-wrap gap-2 mb-2">
                                                                {linkedContact.types.filter(t => t !== linkedContact.defaultType).map(roleCode => (
                                                                    <span key={roleCode} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100">
                                                                        {roles.find(r => r.code === roleCode)?.description || roleCode}
                                                                        <button
                                                                            onClick={() => handleRemoveRole(roleCode)}
                                                                            className="hover:text-red-500 rounded-full p-0.5"
                                                                        >
                                                                            <XIcon size={12} />
                                                                        </button>
                                                                    </span>
                                                                ))}
                                                                <div className="relative group">
                                                                    <button className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-200 transition">
                                                                        <Plus size={12} /> Add Role
                                                                    </button>
                                                                    {/* Quick dropdown for adding roles */}
                                                                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg hidden group-hover:block z-20 max-h-40 overflow-y-auto">
                                                                        {roles.filter(r => !linkedContact.types.includes(r.code)).map(r => (
                                                                            <button
                                                                                key={r.id}
                                                                                onClick={() => handleAddRole(r.code)}
                                                                                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
                                                                            >
                                                                                {r.description}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <p className="text-xs text-slate-400">Assign secondary functional roles (e.g. Planner, Supervisor) to this contact.</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>

                                            {/* FINANCIALS SECTION */}
                                            <section>
                                                <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                                                    <DollarSign size={16} className="text-blue-600" /> Financials
                                                </h3>
                                                <div className="p-5 border border-slate-200 rounded-xl bg-white shadow-sm space-y-4">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        <div>
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Hourly Rate (Override)</label>
                                                            <div className="relative">
                                                                <span className="absolute left-3 top-2 text-slate-400">$</span>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    className="w-full pl-7 p-2 border border-slate-300 rounded-lg text-sm font-mono"
                                                                    value={linkedContact.hourlyRate || ''}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value ? parseFloat(e.target.value) : 0;
                                                                        const updated = { ...linkedContact, hourlyRate: val };
                                                                        setContacts(prev => prev.map(c => c.id === linkedContact.id ? updated : c));
                                                                    }}
                                                                />
                                                            </div>
                                                            <p className="text-xs text-slate-400 mt-1">
                                                                If set, this rate overrides the standard {roles.find(r => r.code === linkedContact.defaultType)?.description} rate.
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cost Center</label>
                                                            <select
                                                                className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                                                value={linkedContact.costCenterId || ''}
                                                                onChange={(e) => {
                                                                    const updated = { ...linkedContact, costCenterId: e.target.value };
                                                                    setContacts(prev => prev.map(c => c.id === linkedContact.id ? updated : c));
                                                                }}
                                                            >
                                                                <option value="">-- No Cost Center --</option>
                                                                {dictionaries.filter(d => d.type === 'COST_CENTRE' && d.active).map(cc => (
                                                                    <option key={cc.id} value={cc.id}>{cc.code} - {cc.description}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>

                                            {/* ORGANIZATION ASSIGNMENT SECTION */}
                                            <section>
                                                <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                                                    <Globe size={16} className="text-blue-600" /> Organization Assignment
                                                </h3>
                                                <div className="p-5 border border-slate-200 rounded-xl bg-white shadow-sm space-y-4">
                                                    <p className="text-sm text-slate-500 mb-2">Select the divisions, groups, teams, or units this user belongs to.</p>
                                                    <OrgTreePicker
                                                        units={orgUnits}
                                                        selectedIds={(() => {
                                                            // Merge organizationUnitId and organizationUnitIds
                                                            const ids = [...(linkedContact.organizationUnitIds || [])];
                                                            if (linkedContact.organizationUnitId && !ids.includes(linkedContact.organizationUnitId)) {
                                                                ids.push(linkedContact.organizationUnitId);
                                                            }
                                                            return ids;
                                                        })()}
                                                        onChange={(newIds) => {
                                                            const updated = {
                                                                ...linkedContact,
                                                                organizationUnitIds: newIds,
                                                                organizationUnitId: newIds.length > 0 ? newIds[0] : null
                                                            };
                                                            setContacts(prev => prev.map(c => c.id === linkedContact.id ? updated : c));
                                                        }}
                                                    />
                                                </div>
                                            </section>

                                            {/* DATA SCOPE SECTION */}
                                            <section>
                                                <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                                                    <Globe size={16} className="text-blue-600" /> Data Scope & Site Access
                                                </h3>
                                                <div className="p-5 border border-slate-200 rounded-xl bg-white shadow-sm space-y-6">
                                                    {/* Mode Selection */}
                                                    <div className="flex gap-4">
                                                        <label className={`flex-1 flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${isGlobalScope ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'}`}>
                                                            <input
                                                                type="radio"
                                                                name="scopeMode"
                                                                checked={isGlobalScope}
                                                                onChange={() => setScopeMode('GLOBAL')}
                                                                className="mt-1 text-blue-600"
                                                            />
                                                            <div>
                                                                <div className="font-bold text-sm text-slate-900">Global Access (Enterprise)</div>
                                                                <div className="text-xs text-slate-500 mt-1">Can access data from all Sites and Locations.</div>
                                                            </div>
                                                        </label>
                                                        <label className={`flex-1 flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${!isGlobalScope ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'}`}>
                                                            <input
                                                                type="radio"
                                                                name="scopeMode"
                                                                checked={!isGlobalScope}
                                                                onChange={() => setScopeMode('SITE_SPECIFIC')}
                                                                className="mt-1 text-blue-600"
                                                            />
                                                            <div>
                                                                <div className="font-bold text-sm text-slate-900">Site Restricted</div>
                                                                <div className="text-xs text-slate-500 mt-1">Access limited to selected Sites only. Multi-site capable.</div>
                                                            </div>
                                                        </label>
                                                    </div>

                                                    {/* Site Selector (Only if Restricted) */}
                                                    {!isGlobalScope && (
                                                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 animate-in slide-in-from-top-2">
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Allowed Sites / Locations</label>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                {sites.map(site => {
                                                                    const isChecked = selectedUser.dataScopeOverrides?.siteIds?.includes(site.id);
                                                                    return (
                                                                        <label key={site.id} className="flex items-center gap-3 p-2 bg-white rounded border border-slate-200 hover:border-blue-300 cursor-pointer transition">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={!!isChecked}
                                                                                onChange={() => toggleSite(site.id)}
                                                                                className="rounded text-blue-600 focus:ring-relantern-500"
                                                                            />
                                                                            <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                                                                <MapPin size={14} className="text-slate-400" /> {site.tag} - {site.name}
                                                                            </span>
                                                                        </label>
                                                                    );
                                                                })}
                                                                {sites.length === 0 && <div className="text-sm text-slate-400 italic">No Sites defined in Asset Registry.</div>}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Granular Constraints */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                                                        <div>
                                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Department Isolation</label>
                                                            <input type="text" placeholder="e.g. Maintenance, Operations (Optional)" className="w-full p-2 border border-slate-300 rounded-lg text-sm" />
                                                            <p className="text-[10px] text-slate-400 mt-1">Leave blank to allow access to all departments within assigned sites.</p>
                                                        </div>
                                                        <div className="flex items-end">
                                                            <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg w-full bg-slate-50 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedUser.dataScopeOverrides?.ownWorkOnly || false}
                                                                    onChange={(e) => toggleOwnWork(e.target.checked)}
                                                                    className="rounded text-blue-600 focus:ring-relantern-500 h-4 w-4"
                                                                />
                                                                <div>
                                                                    <span className="text-sm font-bold text-slate-900 block">Limit to Own Assignments</span>
                                                                    <span className="text-xs text-slate-500">User only sees WOs/Requests assigned to them.</span>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </section>

                                        </div>

                                    )}

                                    {/* MODULE ACCESS GOVERNANCE */}
                                    {activeTab === 'moduleAccess' && (
                                        <section className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
                                            <div>
                                                <h3 className="font-bold text-slate-800 mb-2 text-sm uppercase tracking-wide flex items-center gap-2">
                                                    <Layers size={16} className="text-amber-600" /> Module Access Governance
                                                </h3>
                                                <p className="text-xs text-slate-500 mb-4">
                                                    Enable or disable entire module suites for this user. Disabling a suite hides it completely from navigation — the user cannot see or access any routes within it. This overrides role-based permissions.
                                                </p>
                                            </div>

                                            {/* Premium Module Suite Cards */}
                                            {[
                                                {
                                                    key: 'reliability' as ModuleName,
                                                    label: 'Reliability Suite',
                                                    description: 'Predictive analytics, RCA, FMEA, RCM, Vision AI, and Knowledge Graph.',
                                                    icon: '🔬',
                                                    color: 'blue',
                                                    routes: '/predict, /analyze, /rcm, /vision, /knowledge-graph'
                                                },
                                                {
                                                    key: 'integrity' as ModuleName,
                                                    label: 'Integrity Suite',
                                                    description: 'LOTO, PSM, RBI, Regulatory Compliance, Inspection Scheduling, Thickness Data, Corrosion Rates, and FFS.',
                                                    icon: '🛡️',
                                                    color: 'emerald',
                                                    routes: '/comply/*'
                                                },
                                                {
                                                    key: 'audits' as ModuleName,
                                                    label: 'Audit Suite',
                                                    description: 'ISO 55000 integrated audit assessments, 6M maturity scoring, corrective actions, templates, and collaborative audit workflows.',
                                                    icon: '📋',
                                                    color: 'amber',
                                                    routes: '/audits, /audits/templates, /audits/schedule, /audits/corrective-actions'
                                                },
                                                {
                                                    key: 'sustain' as ModuleName,
                                                    label: 'Sustainability Suite',
                                                    description: 'Environmental reporting, emissions tracking, ESG dashboards, and sustainability KPIs.',
                                                    icon: '🌱',
                                                    color: 'green',
                                                    routes: '/sustain'
                                                },
                                            ].map(suite => {
                                                const currentPerms = effectivePermissions[suite.key];
                                                const isEnabled = currentPerms?.view ?? false;
                                                const bgColor = isEnabled
                                                    ? suite.color === 'blue' ? 'bg-blue-50 border-blue-200' : suite.color === 'emerald' ? 'bg-emerald-50 border-emerald-200' : suite.color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
                                                    : 'bg-slate-50 border-slate-200';
                                                const accentColor = isEnabled
                                                    ? suite.color === 'blue' ? 'text-blue-700' : suite.color === 'emerald' ? 'text-emerald-700' : suite.color === 'amber' ? 'text-amber-700' : 'text-green-700'
                                                    : 'text-slate-400';
                                                const toggleBg = isEnabled
                                                    ? suite.color === 'blue' ? 'bg-blue-600' : suite.color === 'emerald' ? 'bg-emerald-600' : suite.color === 'amber' ? 'bg-amber-600' : 'bg-green-600'
                                                    : 'bg-slate-300';

                                                return (
                                                    <div
                                                        key={suite.key}
                                                        className={`border rounded-xl p-5 transition-all duration-300 ${bgColor}`}
                                                    >
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex items-start gap-3">
                                                                <span className="text-2xl">{suite.icon}</span>
                                                                <div>
                                                                    <h4 className={`font-bold text-base ${isEnabled ? 'text-slate-900' : 'text-slate-500'}`}>
                                                                        {suite.label}
                                                                    </h4>
                                                                    <p className={`text-xs mt-1 max-w-md ${isEnabled ? 'text-slate-600' : 'text-slate-400'}`}>
                                                                        {suite.description}
                                                                    </p>
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        <span className={`text-xs font-mono px-2 py-0.5 rounded ${isEnabled ? 'bg-white/60 text-slate-500' : 'bg-slate-100 text-slate-400'}`}>
                                                                            {suite.routes}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Toggle Switch */}
                                                            <div className="flex flex-col items-end gap-2">
                                                                <button
                                                                    onClick={() => {
                                                                        const newVal = !isEnabled;
                                                                        // Toggle ALL permission flags for this module
                                                                        handlePermissionChange(suite.key, 'view', newVal);
                                                                        if (!newVal) {
                                                                            // If disabling, also revoke all sub-permissions
                                                                            handlePermissionChange(suite.key, 'create', false);
                                                                            handlePermissionChange(suite.key, 'edit', false);
                                                                            handlePermissionChange(suite.key, 'delete', false);
                                                                            handlePermissionChange(suite.key, 'approve', false);
                                                                            handlePermissionChange(suite.key, 'authorize', false);
                                                                            handlePermissionChange(suite.key, 'assign', false);
                                                                            handlePermissionChange(suite.key, 'viewCosts', false);
                                                                        }
                                                                    }}
                                                                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 ${toggleBg} ${isEnabled ? 'focus:ring-blue-500' : 'focus:ring-slate-400'}`}
                                                                    role="switch"
                                                                    aria-checked={isEnabled}
                                                                    aria-label={`Toggle ${suite.label}`}
                                                                >
                                                                    <span
                                                                        className={`inline-flex items-center justify-center h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${isEnabled ? 'translate-x-8' : 'translate-x-1'}`}
                                                                    >
                                                                        {isEnabled ? <Eye size={12} className={accentColor} /> : <EyeOff size={12} className="text-slate-400" />}
                                                                    </span>
                                                                </button>
                                                                <span className={`text-xs font-semibold uppercase tracking-wider ${accentColor}`}>
                                                                    {isEnabled ? 'Enabled' : 'Disabled'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Info Banner */}
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
                                                <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                                                <div className="text-xs text-amber-800">
                                                    <strong>Governance Note:</strong> Disabling a module suite for this user takes immediate effect after saving. The user will not see these modules in their sidebar, and direct URL access will be blocked. For fine-grained control (e.g., view-only vs. edit), use the <strong>Effective Permission Matrix</strong> tab.
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {/* PERMISSIONS MATRIX SECTION */}
                                    {activeTab === 'matrix' && (
                                        <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                                                <Shield size={16} className="text-blue-600" /> Effective Permission Matrix
                                            </h3>
                                            <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                                                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center gap-2 text-xs text-blue-800">
                                                    <AlertCircle size={14} />
                                                    <span>Permissions below are a union of the Base Role and User Overrides.</span>
                                                </div>
                                                <table className="min-w-full divide-y divide-slate-200">
                                                    <thead className="bg-slate-50">
                                                        <tr>
                                                            <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase w-48">Module</th>
                                                            {actions.map(action => (
                                                                <th key={action.key} className="px-2 py-3 text-center text-xs font-semibold text-slate-500 uppercase">{action.label}</th>
                                                            ))}
                                                            <th className="px-2 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Limit ($)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-200 bg-white">
                                                        {modules.map(mod => {
                                                            const perms = effectivePermissions[mod.key] || {
                                                                view: false, create: false, edit: false, delete: false,
                                                                approve: false, authorize: false, assign: false, viewCosts: false, spendingLimit: 0
                                                            };
                                                            return (
                                                                <tr key={mod.key} className="hover:bg-slate-50 transition-colors">
                                                                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{mod.label}</td>
                                                                    {actions.map(action => {
                                                                        const isEnabled = perms[action.key];
                                                                        return (
                                                                            <td key={action.key} className="px-2 py-3 text-center">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={!!isEnabled}
                                                                                    onChange={(e) => handlePermissionChange(mod.key, action.key, e.target.checked)}
                                                                                    className={`w-4 h-4 rounded text-blue-600 focus:ring-relantern-500 border-slate-300 cursor-pointer`}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td className="px-2 py-2 text-center">
                                                                        {(mod.key === 'purchasing' || mod.key === 'requests') ? (
                                                                            <input
                                                                                type="number"
                                                                                placeholder="0.00"
                                                                                className="w-24 text-right text-xs border border-slate-300 rounded p-1"
                                                                                value={perms.spendingLimit || ''}
                                                                                onChange={(e) => handlePermissionChange(mod.key, 'spendingLimit', parseFloat(e.target.value))}
                                                                            />
                                                                        ) : (
                                                                            <span className="text-slate-300 text-xs">-</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                                <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-4">
                                    <AlertTriangle size={32} className="text-orange-500" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800">Incomplete Profile</h3>
                                <p className="max-w-md mt-2 mb-6">This user account ({selectedUser.username}) is not linked to a Contact Record. To assign roles and permissions, you must create a Contact Record.</p>
                                <button
                                    onClick={async () => {
                                        if (!selectedUser) return;
                                        if (confirm('Create a new Contact profile for this user?')) {
                                            const db = DatabaseService.getInstance();
                                            try {
                                                const userNameBase = selectedUser.email ? selectedUser.email.split('@')[0] : (selectedUser.username || 'User');
                                                // Create Contact
                                                const newContact = await db.addContact({
                                                    id: crypto.randomUUID(),
                                                    name: userNameBase,
                                                    code: 'EMP-' + Math.floor(Math.random() * 10000).toString(),
                                                    title: 'System Account',
                                                    email: selectedUser.email || '',
                                                    phone: '',
                                                    mobile: '',
                                                    active: true,
                                                    types: ['TECHNICIAN'],
                                                    defaultType: 'TECHNICIAN',
                                                    department: 'Maintenance',
                                                    hourlyRate: 0,
                                                    currency: 'USD',
                                                    address: { street: '', city: '', state: '', zip: '', country: '' },
                                                    flags: {
                                                        canLogin: true,
                                                        canSubmitRequests: true,
                                                        canLogTime: true,
                                                        isLabour: true,
                                                        hasQualifications: false,
                                                        isVendor: false
                                                    },
                                                    qualifications: []
                                                });
                                                // Link to User
                                                console.log('[Admin] Linking user', selectedUser.id, 'to contact', newContact.id);
                                                const updatedUser = { ...selectedUser, contactId: newContact.id, contact_id: newContact.id };
                                                await db.updateUser(selectedUser.id, { contact_id: newContact.id });
                                                console.log('[Admin] updateUser completed successfully');

                                                // Update Local State
                                                const newContactsList = [...contacts, newContact];
                                                setContacts(newContactsList);

                                                const newUsersList = users.map(u => u.id === selectedUser.id ? updatedUser : u);
                                                setUsers(newUsersList);

                                                // Optional: Show a subtle toast or just let the UI react
                                                // setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 3000);

                                            } catch (e) {
                                                showToast('Failed to create contact: ' + e, 'error');
                                            }
                                        }
                                    }}
                                    className="px-4 py-2 bg-relantern-500 text-white rounded font-medium hover:bg-relantern-600 transition shadow-sm"
                                >
                                    Create Profile
                                </button>
                            </div>
                        )
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center animate-in fade-in zoom-in-95 duration-300">
                            <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center mb-6 shadow-sm border border-slate-100">
                                <ShieldOff size={32} className="text-slate-300" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800">No System Access</h3>
                            <p className="max-w-md mt-3 mb-8 text-slate-500 leading-relaxed">
                                <strong className="text-slate-900">{selectedIdentity?.contact?.name}</strong> is listed as a Contact but does not have a User Account.
                                <br />They cannot log in to the application.
                            </p>
                            <button
                                onClick={async () => {
                                    if (!selectedIdentity?.contact) return;

                                    const c = selectedIdentity.contact;
                                    const baseUsername = c.email ? c.email.split('@')[0] : c.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

                                    // Check if a user with this username already exists
                                    const existingUser = users.find(u => u.username === baseUsername);
                                    let newUsername = baseUsername;

                                    if (existingUser) {
                                        // Check if existing user is already linked to this contact
                                        if (existingUser.contact_id === c.id || existingUser.contactId === c.id) {
                                            showToast(`A user account already exists for ${c.name}. They can log in using username: ${existingUser.username}`, 'info');
                                            // Update local state to reflect the link
                                            setUsers(users.map(u => u.id === existingUser.id ? { ...u, contact_id: c.id, contactId: c.id } : u));
                                            return;
                                        }
                                        // Generate unique username by appending a number
                                        let counter = 1;
                                        while (users.find(u => u.username === `${baseUsername}${counter}`)) {
                                            counter++;
                                        }
                                        newUsername = `${baseUsername}${counter}`;
                                    }

                                    // 2. CHECK FOR EXISTING EMAIL CONFLICT
                                    // If a user exists with this email but weirdly not linked, offers to link them.
                                    const userWithSameEmail = users.find(u => u.email?.toLowerCase() === c.email?.toLowerCase());

                                    if (userWithSameEmail) {
                                        if (confirm(`A user account already exists for ${c.email} (Username: ${userWithSameEmail.username}).\n\nDo you want to link this existing user to ${c.name}?`)) {
                                            const db = DatabaseService.getInstance();
                                            try {
                                                await db.updateUser(userWithSameEmail.id, { contact_id: c.id });
                                                // Update local state
                                                setUsers(users.map(u => u.id === userWithSameEmail.id ? { ...u, contact_id: c.id, contactId: c.id } : u));
                                                showToast(`Successfully linked ${userWithSameEmail.username} to ${c.name}.`, 'success');
                                            } catch (e) {
                                                showToast('Failed to link user: ' + e, 'error');
                                            }
                                        }
                                        return; // Stop here, do not create new
                                    }

                                    // System Analyst recommendation: Simplify flow for Admins.
                                    // Use a standard default password that must be changed on first login (future feature).
                                    // For now, use a consistent default to reduce friction.
                                    if (confirm(`Grant System Access to ${c.name} (@${newUsername})?\n\nA user account will be created with the default password: ChangeMe123!`)) {
                                        const db = DatabaseService.getInstance();
                                        try {
                                            const newUser: any = {
                                                id: crypto.randomUUID(),
                                                username: newUsername,
                                                email: c.email,
                                                contactId: c.id,
                                                contact_id: c.id,
                                                roles: ['USER'],
                                                active: true,
                                                password: 'ChangeMe123!',
                                                mfaEnabled: false,
                                                permissionOverrides: {},
                                                dataScopeOverrides: {}
                                            };

                                            await db.createUser(newUser);
                                            setUsers([...users, newUser]);
                                        } catch (e) {
                                            showToast('Failed to create user: ' + e, 'error');
                                            console.error(e);
                                        }
                                    }
                                }}
                                className="px-6 py-3 bg-relantern-500 text-white rounded-lg font-bold hover:bg-relantern-600 transition shadow-md hover:shadow-lg flex items-center gap-2"
                            >
                                <UserPlus size={18} /> Grant System Access
                            </button>
                            <p className="mt-4 text-xs text-slate-400">Default password will be set to: <strong>ChangeMe123!</strong></p>
                        </div>
                    )
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                        <Users size={64} className="mb-4 opacity-20" />
                        <p>Select a Person to manage their access.</p>
                    </div>
                )}
            </div>

        </div >
    );
};

// --- Main Admin Layout ---

export const Admin: React.FC = () => {
    const { permissions } = useAuth();
    const [activeTab, setActiveTab] = useState<AdminTab>('dictionaries');
    const { showToast } = useToast();

    const handleSeedDictionaries = async () => {
        if (!confirm("This will insert missing dictionary entries (Status, Priority, etc.). Continue?")) return;

        const SEED_DATA = [
            // WORK_TYPE
            { type: 'WORK_TYPE', code: 'PM', description: 'Preventive Maintenance', active: true },
            { type: 'WORK_TYPE', code: 'CM', description: 'Corrective Maintenance', active: true },
            { type: 'WORK_TYPE', code: 'PdM', description: 'Predictive Maintenance', active: true },
            { type: 'WORK_TYPE', code: 'EM', description: 'Emergency Maintenance', active: true },
            { type: 'WORK_TYPE', code: 'MOD', description: 'Modification / Project', active: true },
            { type: 'WORK_TYPE', code: 'REF', description: 'Refurbishment', active: true },
            { type: 'WORK_TYPE', code: 'INSP', description: 'Inspection', active: true },

            // PRIORITY
            { type: 'PRIORITY', code: '1', description: 'Emergency (Immediate)', active: true },
            { type: 'PRIORITY', code: '2', description: 'Urgent (24 Hours)', active: true },
            { type: 'PRIORITY', code: '3', description: 'Routine (7 Days)', active: true },
            { type: 'PRIORITY', code: '4', description: 'Scheduled (Next Shutdown)', active: true },

            // STATUS_CODE
            { type: 'STATUS_CODE', code: 'OPEN', description: 'Open', active: true },
            { type: 'STATUS_CODE', code: 'PLAN', description: 'Planning', active: true },
            { type: 'STATUS_CODE', code: 'SCHED', description: 'Scheduled', active: true },
            { type: 'STATUS_CODE', code: 'WIP', description: 'Work In Progress', active: true },
            { type: 'STATUS_CODE', code: 'WAIT', description: 'Waiting for Parts/Access', active: true },
            { type: 'STATUS_CODE', code: 'TECO', description: 'Technically Complete', active: true },
            { type: 'STATUS_CODE', code: 'CLOSED', description: 'Closed (Financial)', active: true },
            { type: 'STATUS_CODE', code: 'CANC', description: 'Cancelled', active: true },
            // Service Request Statuses
            { type: 'STATUS_CODE', code: 'NEW', description: 'New / Draft', active: true },
            { type: 'STATUS_CODE', code: 'REVIEW', description: 'Under Review', active: true },
            { type: 'STATUS_CODE', code: 'AUTHORIZED', description: 'Authorized (Budget)', active: true },
            { type: 'STATUS_CODE', code: 'APPROVED', description: 'Approved (Technical)', active: true },
            { type: 'STATUS_CODE', code: 'REJECTED', description: 'Rejected', active: true },
            { type: 'STATUS_CODE', code: 'CONVERTED', description: 'Converted to Work Order', active: true },
            // Recurring Job Statuses
            { type: 'STATUS_CODE', code: 'ACTIVE', description: 'Active', active: true },
            { type: 'STATUS_CODE', code: 'PAUSED', description: 'Paused', active: true },

            // COST_CENTRE
            { type: 'COST_CENTRE', code: 'M-100', description: 'Mechanical Maintenance', active: true },
            { type: 'COST_CENTRE', code: 'E-200', description: 'Electrical Maintenance', active: true },
            { type: 'COST_CENTRE', code: 'I-300', description: 'Instrumentation', active: true },
            { type: 'COST_CENTRE', code: 'OPS-01', description: 'Operations - Unit 1', active: true },
            { type: 'COST_CENTRE', code: 'OPS-02', description: 'Operations - Unit 2', active: true },
            { type: 'COST_CENTRE', code: 'ADM-900', description: 'Plant Administration', active: true },

            // FAILURE_MODE
            { type: 'FAILURE_MODE', code: 'F-ST', description: 'Fail to Start', active: true },
            { type: 'FAILURE_MODE', code: 'F-RN', description: 'Fail to Run', active: true },
            { type: 'FAILURE_MODE', code: 'F-STP', description: 'Fail to Stop', active: true },
            { type: 'FAILURE_MODE', code: 'EL', description: 'External Leakage', active: true },
            { type: 'FAILURE_MODE', code: 'IL', description: 'Internal Leakage', active: true },
            { type: 'FAILURE_MODE', code: 'VIB', description: 'Vibration', active: true },
            { type: 'FAILURE_MODE', code: 'OHT', description: 'Overheating', active: true },
            { type: 'FAILURE_MODE', code: 'NOI', description: 'Noise', active: true },
            { type: 'FAILURE_MODE', code: 'LO', description: 'Low Output', active: true },
            { type: 'FAILURE_MODE', code: 'HO', description: 'High Output', active: true },
            { type: 'FAILURE_MODE', code: 'UNK', description: 'Unknown / Other', active: true },

            // REMEDY_CODE
            { type: 'REMEDY_CODE', code: 'REP', description: 'Repaired', active: true },
            { type: 'REMEDY_CODE', code: 'RPL', description: 'Replaced', active: true },
            { type: 'REMEDY_CODE', code: 'ADJ', description: 'Adjusted', active: true },
            { type: 'REMEDY_CODE', code: 'CLN', description: 'Cleaned', active: true },
            { type: 'REMEDY_CODE', code: 'INS', description: 'Inspected', active: true },
            { type: 'REMEDY_CODE', code: 'MOD', description: 'Modified', active: true },
            { type: 'REMEDY_CODE', code: 'OVR', description: 'Overhauled', active: true },

            // COST_CENTER_TYPE (New Custom Types)
            { type: 'COST_CENTER_TYPE', code: 'MAINTENANCE', description: 'Maintenance', active: true },
            { type: 'COST_CENTER_TYPE', code: 'PROJECT', description: 'Capital Projects', active: true },
            { type: 'COST_CENTER_TYPE', code: 'OVERHEAD', description: 'General Overhead', active: true },
            { type: 'COST_CENTER_TYPE', code: 'PRODUCTION', description: 'Production Operations', active: true },
        ];

        try {
            console.log('Seeding dictionaries...');
            let count = 0;
            for (const item of SEED_DATA) {
                try {
                    // Use DatabaseService to ensure federation (COST_CENTRE -> FinOps)
                    // We need to cast item to any or DictionaryRecord. 
                    // addDictionary expects { ...DictionaryRecord }.
                    await DatabaseService.getInstance().addDictionary(item as any);
                    count++;
                } catch (e: any) {
                    console.warn(`Skipping seed item ${item.code}:`, e.message);
                }
            }

            // Also reload dictionaries to refresh UI
            // const newDicts = await DatabaseService.getInstance().getDictionaries();
            // setDictionaries(newDicts);

            showToast(`Seeding complete! Added/Updated ${count} entries.`, 'success');
        } catch (e: any) {
            console.error(e);
            showToast('Seeding failed: ' + e.message, 'error');
        }
    };

    if (permissions && !permissions.admin?.view) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh]">
                <Shield size={64} className="text-slate-200 mb-4" />
                <h2 className="text-xl font-bold text-slate-700">Access Denied</h2>
                <p className="text-slate-500 mt-2">You do not have permission to access the System Administration module.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-6rem)]">
            <div className="mb-6 flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">System Administration</h1>
                    <p className="text-sm text-slate-500">Configure dictionaries, role permissions, and system settings.</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col">
                {/* Tabs */}
                <div className="border-b border-slate-200 flex overflow-x-auto scrollbar-hide">
                    <button
                        onClick={() => setActiveTab('dictionaries')}
                        className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'dictionaries' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Database size={16} /> Dictionaries
                    </button>
                    <button
                        onClick={() => setActiveTab('permissions')}
                        className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'permissions' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Shield size={16} /> User Access
                    </button>
                    <button
                        onClick={() => setActiveTab('notifications')}
                        className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'notifications' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Bell size={16} /> Notifications
                    </button>
                    <button
                        onClick={() => setActiveTab('libraries')}
                        className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'libraries' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <BookOpen size={16} /> Task Library
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`px-6 py-4 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'settings' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Settings size={16} /> Configuration
                    </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden relative bg-slate-50/50">
                    {activeTab === 'dictionaries' && <DictionaryManager />}
                    {activeTab === 'permissions' && <UserPermissionManager />}
                    {activeTab === 'notifications' && <NotificationConfig />}
                    {activeTab === 'libraries' && <TaskLibraryManager />}
                    {activeTab === 'settings' && (
                        <div className="animate-in fade-in duration-300 space-y-6">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                    <Database size={20} className="text-blue-600" />
                                    System Maintenance
                                </h3>
                                <div className="space-y-4">
                                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap justify-between items-center gap-3">
                                        <div>
                                            <h4 className="font-bold text-slate-700">Seed Work Order Dictionaries</h4>
                                            <p className="text-sm text-slate-500">Populate missing ISO 14224 codes (Priority, Status, Failure Modes, etc.)</p>
                                        </div>
                                        <button
                                            id="seed-dictionaries-btn"
                                            onClick={handleSeedDictionaries}
                                            className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm"
                                        >
                                            Seed Dictionaries
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}
