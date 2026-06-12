import React, { useState, useEffect } from 'react';
import { Contact, DictionaryEntry, User, ManufacturerModel, Qualification, EntityFile, JournalEntry } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { ImageCapture } from '../components/ui/ImageCapture';
import {
    Trash2, Plus, FileText, CheckSquare, Calendar, Download,
    ExternalLink, HardDrive, Clock, AlertCircle, Key, Copy, Camera,
    Award, ShieldAlert, X
} from 'lucide-react';
import { NotificationService } from '../services/NotificationService';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';

// --- DETAILS TAB ---
export const DetailsTab: React.FC<{
    contact: Contact;
    allContacts: Contact[];
    dictionaries: DictionaryEntry[];
    onChange: (c: Contact) => void;
    onDelete?: (id: string) => void;
    onDuplicate?: (contact: Contact) => void;
}> = ({ contact, allContacts, dictionaries, onChange, onDelete, onDuplicate }) => {
    const contactTypes = React.useMemo(() => {
        const raw = dictionaries.filter(d => d.type === 'CONTACT_TYPE');
        // Filter out banned roles and deduplicate
        const unique = new Map();
        raw.forEach(d => {
            // Banned Codes/Descriptions
            if (['VENDOR', 'MANUFACTURER', 'SUPPLIER'].includes(d.code)) return;
            if (['Equipment Manufacturer', 'External Vendor', 'Supplier'].includes(d.description)) return;

            // Deduplicate by Code AND Description
            if (!unique.has(d.code) && !Array.from(unique.values()).some((v: any) => v.description === d.description)) {
                unique.set(d.code, d);
            }
        });
        return Array.from(unique.values());
    }, [dictionaries]);
    const [orgUnits, setOrgUnits] = useState<any[]>([]);

    useEffect(() => {
        DatabaseService.getInstance().getOrgUnits().then(setOrgUnits);
    }, []);

    const handleTypeToggle = (typeCode: string) => {
        const currentTypes = new Set(contact.types || []);
        if (currentTypes.has(typeCode)) currentTypes.delete(typeCode);
        else currentTypes.add(typeCode);
        onChange({ ...contact, types: Array.from(currentTypes) });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-4">
                    <h3 className="font-semibold text-slate-900">Identity & Classification</h3>
                    <div className="flex gap-2">
                        {/* Icons removed as per user request */}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {/* Avatar Upload */}
                    <div className="col-span-2 flex justify-center mb-4">
                        <ImageCapture
                            bucket="avatars"
                            prefix="contact_"
                            currentImage={contact.image}
                            onImageCaptured={(url) => onChange({ ...contact, image: url })}
                            onRemove={() => onChange({ ...contact, image: undefined })}
                            shape="circle"
                            size="md"
                        />
                    </div>
                    {/* Username / Code at top - READ ONLY after creation */}
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-500 uppercase">Username <span className="text-slate-400 font-normal">(Unique Identifier)</span></label>
                        <input type="text" value={contact.code || ''} disabled className="mt-1 w-full text-sm border border-slate-200 rounded-md bg-slate-100 p-2 font-mono text-slate-700 cursor-not-allowed" />
                    </div>
                    {/* Description (renamed from Title/Role) */}
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-500 uppercase">Description</label>
                        <input type="text" value={contact.title || ''} onChange={e => onChange({ ...contact, title: e.target.value })} className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-white p-2" placeholder="e.g. Senior Technician, Maintenance Lead" />
                    </div>
                    {/* First/Last Name below description */}
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase">First Name</label>
                        <input type="text" value={contact.firstName || ''} onChange={e => onChange({ ...contact, firstName: e.target.value, name: `${e.target.value} ${contact.lastName || ''}`.trim() })} className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-slate-50 p-2" />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase">Last Name</label>
                        <input type="text" value={contact.lastName || ''} onChange={e => onChange({ ...contact, lastName: e.target.value, name: `${contact.firstName || ''} ${e.target.value}`.trim() })} className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-slate-50 p-2" />
                    </div>
                    {/* Cost Center */}
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-500 uppercase">Cost Center</label>
                        <select
                            className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-white p-2"
                            value={contact.costCenterId || ''}
                            onChange={e => onChange({ ...contact, costCenterId: e.target.value || undefined })}
                        >
                            <option value="">(None)</option>
                            {dictionaries.filter(d => d.type === 'COST_CENTRE' && d.active).map(cc => (
                                <option key={cc.id} value={cc.id}>{cc.code} - {cc.description}</option>
                            ))}
                        </select>
                    </div>

                    {/* Base Role */}
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-500 uppercase">Role <span className="text-slate-400 font-normal">(Primary)</span></label>
                        <select
                            className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-white p-2"
                            value={contact.defaultType || ''}
                            onChange={e => {
                                const newRole = e.target.value;
                                // Keep existing secondary types, replace the primary
                                const otherTypes = (contact.types || []).filter(t => t !== contact.defaultType && t !== newRole);
                                const newTypes = newRole ? [newRole, ...otherTypes] : otherTypes;
                                onChange({ ...contact, defaultType: (newRole || undefined) as string, types: newTypes });
                            }}
                        >
                            <option value="">(None)</option>
                            {contactTypes.map(ct => (
                                <option key={ct.id} value={ct.code}>{ct.description}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-[10px] text-slate-400">Synced with Admin → User Access</p>
                    </div>

                    {/* Additional Roles */}
                    <div className="col-span-2">
                        <label className="block text-xs font-medium text-slate-500 uppercase mb-2">Additional Roles</label>
                        {/* Assigned secondary role chips */}
                        <div className="flex flex-wrap gap-2 mb-2 min-h-[28px]">
                            {(contact.types || [])
                                .filter(t => t !== contact.defaultType)
                                .map(roleCode => {
                                    const entry = contactTypes.find(ct => ct.code === roleCode);
                                    return (
                                        <span key={roleCode} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 group hover:bg-blue-100 transition-colors">
                                            {entry?.description || roleCode}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newTypes = (contact.types || []).filter(t => t !== roleCode);
                                                    onChange({ ...contact, types: newTypes });
                                                }}
                                                className="ml-0.5 rounded-full p-0.5 text-blue-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                title="Remove role"
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    );
                                })}
                            {(contact.types || []).filter(t => t !== contact.defaultType).length === 0 && (
                                <span className="text-xs text-slate-400 italic py-1">No additional roles assigned</span>
                            )}
                        </div>
                        {/* Dropdown to add a new role */}
                        <select
                            className="w-full text-sm border border-slate-300 rounded-md bg-white p-2 text-slate-600"
                            value=""
                            onChange={e => {
                                const newRole = e.target.value;
                                if (!newRole) return;
                                const currentTypes = contact.types || [];
                                if (!currentTypes.includes(newRole)) {
                                    onChange({ ...contact, types: [...currentTypes, newRole] });
                                }
                            }}
                        >
                            <option value="">+ Assign another role...</option>
                            {contactTypes
                                .filter(ct => !(contact.types || []).includes(ct.code))
                                .map(ct => (
                                    <option key={ct.id} value={ct.code}>{ct.description}</option>
                                ))}
                        </select>
                    </div>

                    {/* Primary Organization Unit - EDITABLE */}
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Primary Organization Unit</label>
                        <select
                            className="w-full text-sm border border-slate-300 rounded-md bg-white p-2"
                            value={contact.organizationUnitId || ''}
                            onChange={e => {
                                const newUnitId = e.target.value || undefined;
                                const currentIds = contact.organizationUnitIds || [];
                                // Update primary FK + ensure it's in the M2M array
                                const newIds = newUnitId
                                    ? [newUnitId, ...currentIds.filter(id => id !== newUnitId && id !== contact.organizationUnitId)]
                                    : currentIds.filter(id => id !== contact.organizationUnitId);
                                onChange({ ...contact, organizationUnitId: newUnitId, organizationUnitIds: newIds });
                            }}
                        >
                            <option value="">(None)</option>
                            {orgUnits.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.name} ({u.type})
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-[10px] text-slate-400">Synced with Org Chart &amp; Admin → User Access</p>
                    </div>

                    {/* Additional Org Assignments - Read Only */}
                    {(contact.organizationUnitIds || []).filter(id => id !== contact.organizationUnitId).length > 0 && (
                        <div className="col-span-2">
                            <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Additional Assignments</label>
                            <div className="flex flex-wrap gap-2">
                                {orgUnits.filter(u => contact.organizationUnitIds?.includes(u.id) && u.id !== contact.organizationUnitId).map(unit => (
                                    <span key={unit.id} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-slate-200 text-slate-700 shadow-sm">
                                        <span className={`w-1.5 h-1.5 rounded-full mr-2 ${unit.type === 'DIVISION' ? 'bg-indigo-500' : unit.type === 'GROUP' ? 'bg-blue-500' : 'bg-sky-500'}`}></span>
                                        {unit.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}


                </div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
                <div>
                    <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">Reporting</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase">Parent Contact (Direct Report)</label>
                            <select className="mt-1 w-full text-sm border border-slate-300 rounded-md bg-white p-2" value={contact.parentId || ''} onChange={e => onChange({ ...contact, parentId: e.target.value || undefined })}>
                                <option value="">(None) - Top Level</option>
                                {allContacts.filter(c => c.id !== contact.id).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div>
                    <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">Communication</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase">Email</label>
                            <input type="email" value={contact.email} onChange={e => onChange({ ...contact, email: e.target.value })} className="mt-1 w-full text-sm border border-slate-300 rounded-md p-2" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Phone</label>
                                <input type="text" value={contact.phone} onChange={e => onChange({ ...contact, phone: e.target.value })} className="mt-1 w-full text-sm border border-slate-300 rounded-md p-2" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 uppercase">Mobile</label>
                                <input type="text" value={contact.mobile} onChange={e => onChange({ ...contact, mobile: e.target.value })} className="mt-1 w-full text-sm border border-slate-300 rounded-md p-2" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 uppercase">Address</label>
                            <textarea rows={3} value={contact.address?.street || ''} onChange={e => onChange({ ...contact, address: { ...(contact.address || { street: '' }), street: e.target.value } as any })} className="mt-1 w-full text-sm border border-slate-300 rounded-md p-2" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- PROPERTIES TAB ---
export const PropertiesTab: React.FC<{ contact: Contact, users: User[], onChange: (c: Contact) => void }> = ({ contact, users, onChange }) => {
    const linkedUser = users.find((u: any) => u.contactId === contact.id || u.contact_id === contact.id);

    const handleFlagToggle = (key: string) => {
        const currentFlags = contact.flags || {} as any;
        onChange({ ...contact, flags: { ...currentFlags, [key]: !currentFlags[key as keyof typeof currentFlags] } });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                    <Key size={18} className="text-blue-600" /> System Access
                </h3>
                {linkedUser ? (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm font-bold text-green-800">Linked User Account</div>
                        <div className="text-xs text-green-600 font-mono mt-1">@{linkedUser.username}</div>
                    </div>
                ) : (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-sm text-slate-500">
                        No user account linked.
                    </div>
                )}
            </div>

            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2 mb-4">Settings & Flags</h3>
                <div className="space-y-2">
                    <div className="space-y-2">
                        {Object.entries(contact.flags || {}).map(([key, val]) => (
                            <label key={key} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded cursor-pointer border border-transparent hover:border-slate-100">
                                <span className="text-sm text-slate-700 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                <input type="checkbox" checked={!!val} onChange={() => handleFlagToggle(key as any)} className="rounded text-blue-600" />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- FIELDS TAB ---
export const FieldsTab: React.FC<{ contact: Contact, onChange: (c: Contact) => void }> = ({ contact, onChange }) => {
    const fields = contact.customFields || [];

    const updateField = (index: number, key: string, value: string) => {
        const newFields = [...fields];
        newFields[index] = { ...newFields[index], key: key as any, value };
        // Note: Generic key update for now, ideally key is fixed
        onChange({ ...contact, customFields: newFields });
    };

    const addField = () => {
        onChange({ ...contact, customFields: [...fields, { id: `cf-${Date.now()}`, key: "New Field", label: "New Field", type: 'TEXT', value: '' } as any] });
    };

    const removeField = (index: number) => {
        const newFields = fields.filter((_, i) => i !== index);
        onChange({ ...contact, customFields: newFields });
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-900">Custom Fields</h3>
                <button onClick={addField} className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={16} /> Add Field</button>
            </div>
            {fields.length === 0 && <div className="text-center text-slate-400 py-8 italic">No custom fields defined.</div>}
            <div className="space-y-3">
                {fields.map((field, i) => (
                    <div key={i} className="flex gap-2 items-center">
                        <input className="w-1/3 text-sm border border-slate-200 rounded p-2" value={(field as any).label || field.key} onChange={e => {
                            const nf = [...fields]; (nf[i] as any).label = e.target.value; onChange({ ...contact, customFields: nf });
                        }} placeholder="Label" />
                        <input className="flex-1 text-sm border border-slate-200 rounded p-2" value={String(field.value)} onChange={e => {
                            const nf = [...fields]; nf[i].value = e.target.value; onChange({ ...contact, customFields: nf });
                        }} placeholder="Value" />
                        <button onClick={() => removeField(i)} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- MODELS TAB ---
export const ModelsTab: React.FC<{ contact: Contact }> = ({ contact }) => {
    const [models, setModels] = useState<ManufacturerModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [newModel, setNewModel] = useState({ code: '', description: '' });
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; modelId: string | null }>({
        isOpen: false,
        modelId: null
    });

    useEffect(() => { loadModels(); }, [contact.id]);

    const loadModels = async () => {
        setLoading(true);
        try {
            const data = await DatabaseService.getInstance().getContactModels(contact.id);
            setModels(data);
        } finally { setLoading(false); }
    };

    const handleAdd = async () => {
        if (!newModel.code) return;
        await DatabaseService.getInstance().addContactModel(contact.id, { ...newModel, active: true });
        setNewModel({ code: '', description: '' });
        loadModels();
    };

    const handleDeleteClick = (id: string) => {
        setDeleteModal({ isOpen: true, modelId: id });
    };

    const handleConfirmDelete = async () => {
        if (deleteModal.modelId) {
            await DatabaseService.getInstance().deleteContactModel(deleteModal.modelId);
            loadModels();
        }
        setDeleteModal({ isOpen: false, modelId: null });
    };

    return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex gap-4">
                <input className="w-40 text-sm border border-slate-300 rounded p-2" placeholder="Model Code" value={newModel.code} onChange={e => setNewModel({ ...newModel, code: e.target.value })} />
                <input className="flex-1 text-sm border border-slate-300 rounded p-2" placeholder="Description" value={newModel.description} onChange={e => setNewModel({ ...newModel, description: e.target.value })} />
                <button onClick={handleAdd} disabled={!newModel.code} className="px-4 py-2 bg-relantern-500 text-white rounded hover:bg-relantern-600 disabled:opacity-50 text-sm font-medium">Add Model</button>
            </div>
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Code</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
                        <th className="px-6 py-3 text-right"></th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                    {models.map(m => (
                        <tr key={m.id}>
                            <td className="px-6 py-4 text-sm font-medium text-slate-900">{m.code}</td>
                            <td className="px-6 py-4 text-sm text-slate-500">{m.description}</td>
                            <td className="px-6 py-4 text-right">
                                <button onClick={() => handleDeleteClick(m.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                            </td>
                        </tr>
                    ))}
                    {models.length === 0 && !loading && <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">No models found.</td></tr>}
                </tbody>
            </table>
            <ConfirmationModal
                isOpen={deleteModal.isOpen}
                onClose={() => setDeleteModal({ isOpen: false, modelId: null })}
                onConfirm={handleConfirmDelete}
                title="Delete Model?"
                message="Are you sure you want to delete this manufacturer model? This action cannot be undone."
                type="danger"
                confirmText="Delete Model"
            />
        </div>
    );
};

// --- QUALIFICATIONS TAB ---
export const QualificationsTab: React.FC<{ contact: Contact }> = ({ contact }) => {
    const [quals, setQuals] = useState<Qualification[]>([]);
    const [qualTypes, setQualTypes] = useState<DictionaryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);

    // Form state
    const [formType, setFormType] = useState('');
    const [formName, setFormName] = useState('');
    const [formDateAchieved, setFormDateAchieved] = useState('');
    const [formDateExpires, setFormDateExpires] = useState('');
    const [formStatus, setFormStatus] = useState<'Active' | 'Pending' | 'Expired'>('Active');
    const [formNotes, setFormNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => { loadData(); }, [contact.id]);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();
            const [qualData, dicts] = await Promise.all([
                db.getQualifications(contact.id),
                db.getDictionaries()
            ]);
            setQuals(qualData);
            const qt = dicts.filter((d: DictionaryEntry) => d.type === 'QUALIFICATION_TYPE' && d.active);
            setQualTypes(qt);

            // Trigger expiry notifications
            if (qualData.length > 0) {
                NotificationService.triggerQualificationExpiryNotifications(qualData, contact.name).catch(console.error);
            }
        } finally { setLoading(false); }
    };

    const resetForm = () => {
        setFormType(''); setFormName(''); setFormDateAchieved(''); setFormDateExpires('');
        setFormStatus('Active'); setFormNotes('');
        setShowForm(false);
    };

    const handleAdd = async () => {
        if (!formName.trim()) return;
        setSaving(true);
        try {
            await DatabaseService.getInstance().addQualification(contact.id, {
                name: formName.trim(),
                type: formType || 'CERT',
                status: formStatus,
                dateAchieved: formDateAchieved || new Date().toISOString().split('T')[0],
                dateExpires: formDateExpires || undefined,
                notes: formNotes || undefined
            });
            resetForm();
            loadData();
        } finally { setSaving(false); }
    };

    const handleDelete = async (id: string) => {
        await DatabaseService.getInstance().deleteQualification(id);
        setDeleteId(null);
        loadData();
    };

    // Compute validity status from expiry date
    const getValidityInfo = (dateExpires?: string) => {
        if (!dateExpires) return { color: 'bg-slate-100 text-slate-600', label: 'No Expiry', icon: null, days: null };
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const expiry = new Date(dateExpires); expiry.setHours(0, 0, 0, 0);
        const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (days < 0) return { color: 'bg-red-100 text-red-700 border-red-200', label: `Expired ${Math.abs(days)}d ago`, icon: '🔴', days };
        if (days <= 7) return { color: 'bg-red-50 text-red-600 border-red-200', label: `${days}d left`, icon: '🔴', days };
        if (days <= 30) return { color: 'bg-amber-50 text-amber-700 border-amber-200', label: `${days}d left`, icon: '🟡', days };
        return { color: 'bg-green-50 text-green-700 border-green-200', label: `${days}d left`, icon: '🟢', days };
    };

    const getTypeName = (code: string) => qualTypes.find(qt => qt.code === code)?.description || code;

    return (
        <div className="space-y-4">
            {/* Delete Confirmation */}
            {deleteId && (
                <ConfirmationModal
                    isOpen={true}
                    onClose={() => setDeleteId(null)}
                    onConfirm={() => handleDelete(deleteId)}
                    title="Delete Qualification"
                    message="Are you sure you want to remove this qualification? This action cannot be undone."
                    confirmText="Delete"
                    type="danger"
                />
            )}

            <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Award size={18} className="text-blue-600" />
                    Certifications & Licenses
                </h3>
                {!showForm && (
                    <button onClick={() => setShowForm(true)} className="text-sm bg-relantern-500 text-white px-3 py-1.5 rounded-lg hover:bg-relantern-600 flex items-center gap-1 transition-colors">
                        <Plus size={16} /> Add New
                    </button>
                )}
            </div>

            {/* Add Form */}
            {showForm && (
                <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex justify-between items-center">
                        <h4 className="font-semibold text-slate-800">New Qualification</h4>
                        <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Type *</label>
                            <select value={formType} onChange={e => setFormType(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500">
                                <option value="">Select type...</option>
                                {qualTypes.map(qt => (
                                    <option key={qt.id} value={qt.code}>{qt.description}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Name *</label>
                            <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                                placeholder="e.g. BOSIET, Working at Heights"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Date Achieved</label>
                            <input type="date" value={formDateAchieved} onChange={e => setFormDateAchieved(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Expiry Date</label>
                            <input type="date" value={formDateExpires} onChange={e => setFormDateExpires(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Status</label>
                            <select value={formStatus} onChange={e => setFormStatus(e.target.value as any)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500">
                                <option value="Active">Active</option>
                                <option value="Pending">Pending</option>
                                <option value="Expired">Expired</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-600 block mb-1">Notes</label>
                            <input type="text" value={formNotes} onChange={e => setFormNotes(e.target.value)}
                                placeholder="Certificate number, issuer, etc."
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-relantern-500 focus:border-blue-500" />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <button onClick={resetForm} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                        <button onClick={handleAdd} disabled={!formName.trim() || saving}
                            className="px-4 py-2 text-sm bg-relantern-500 text-white rounded-lg hover:bg-relantern-600 disabled:opacity-50 flex items-center gap-1">
                            {saving ? 'Saving...' : <><Plus size={14} /> Save Qualification</>}
                        </button>
                    </div>
                </div>
            )}

            {/* Qualifications List */}
            <div className="grid grid-cols-1 gap-3">
                {quals.map(q => {
                    const validity = getValidityInfo(q.dateExpires);
                    return (
                        <div key={q.id} className={`bg-white p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow ${validity.days !== null && validity.days < 0 ? 'border-red-200' : validity.days !== null && validity.days <= 30 ? 'border-amber-200' : 'border-slate-200'}`}>
                            <div className="flex justify-between items-start">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${validity.days !== null && validity.days < 0 ? 'bg-red-100 text-red-600' : validity.days !== null && validity.days <= 30 ? 'bg-amber-100 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                        {validity.days !== null && validity.days < 0 ? <ShieldAlert size={20} /> : <Award size={20} />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-slate-900 truncate">{q.name}</div>
                                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            <span className="px-2 py-0.5 text-[10px] rounded font-bold uppercase bg-slate-100 text-slate-600">{getTypeName(q.type)}</span>
                                            {q.dateAchieved && <span className="text-[11px] text-slate-500">Achieved: {new Date(q.dateAchieved).toLocaleDateString()}</span>}
                                        </div>
                                        {q.notes && <div className="text-xs text-slate-500 mt-1 truncate">{q.notes}</div>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {/* Validity Indicator */}
                                    <div className="text-right">
                                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${validity.color}`}>
                                            {validity.icon && <span>{validity.icon}</span>}
                                            {validity.label}
                                        </div>
                                        {q.dateExpires && (
                                            <div className="text-[10px] text-slate-400 mt-0.5 text-right">
                                                {new Date(q.dateExpires).toLocaleDateString()}
                                            </div>
                                        )}
                                    </div>
                                    <button onClick={() => setDeleteId(q.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {quals.length === 0 && !loading && (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <Award size={40} className="mx-auto text-slate-300 mb-3" />
                        <p className="text-slate-500 font-medium">No qualifications recorded</p>
                        <p className="text-xs text-slate-400 mt-1">Click "Add New" to record certifications and licenses.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- FILES TAB ---
export const FilesTab: React.FC<{ contact: Contact }> = ({ contact }) => {
    const [files, setFiles] = useState<EntityFile[]>([]);

    useEffect(() => {
        DatabaseService.getInstance().getEntityFiles(contact.id, 'CONTACT').then(setFiles);
    }, [contact.id]);

    const handleUpload = async () => {
        // Mock upload
        await DatabaseService.getInstance().addEntityFile({
            entityId: contact.id, entityType: 'CONTACT',
            name: `Document_${Math.floor(Math.random() * 100)}.pdf`,
            url: '#', sizeBytes: 1024 * Math.random() * 1000,
            uploadedBy: 'system', createdAt: new Date().toISOString()
        } as any);
        DatabaseService.getInstance().getEntityFiles(contact.id, 'CONTACT').then(setFiles);
    };

    return (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between">
                <h3 className="font-bold text-slate-700">Attachments</h3>
                <button onClick={handleUpload} className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded flex items-center gap-2"><Plus size={16} /> Upload File</button>
            </div>
            <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-white"><tr><th className="px-6 py-3 text-left text-xs text-slate-500 uppercase">Name</th><th className="px-6 py-3 text-left text-xs text-slate-500 uppercase">Size</th><th className="px-6 py-3 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-slate-200">
                    {files.map(f => (
                        <tr key={f.id}>
                            <td className="px-6 py-4 text-sm font-medium text-slate-900 flex items-center gap-2"><FileText size={16} className="text-slate-400" /> {f.name}</td>
                            <td className="px-6 py-4 text-sm text-slate-500">{(f.sizeBytes ? f.sizeBytes / 1024 : 0).toFixed(1)} KB</td>
                            <td className="px-6 py-4 text-right"><button className="text-blue-600 hover:underline text-xs">Download</button></td>
                        </tr>
                    ))}
                    {files.length === 0 && <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400 italic">No files attached.</td></tr>}
                </tbody>
            </table>
        </div>
    );
};

// --- LABOR TAB ---
export const LaborTab: React.FC<{ contact: Contact, onChange: (c: Contact) => void }> = ({ contact, onChange }) => {
    const rules = contact.labourRules || { days: [], startTime: '08:00', endTime: '17:00', dailyHours: 8 };
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const toggleDay = (d: string) => {
        const currentDays = new Set(rules.days || []);
        if (currentDays.has(d)) currentDays.delete(d); else currentDays.add(d);
        onChange({ ...contact, labourRules: { ...rules, days: Array.from(currentDays) } });
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-6">
            <h3 className="font-semibold text-slate-900 border-b border-slate-100 pb-2">Working Hours & Availability</h3>

            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Standard Work Days</label>
                <div className="flex gap-2">
                    {days.map(d => (
                        <button key={d} onClick={() => toggleDay(d)} className={`h-8 w-8 rounded-full text-xs font-bold transition ${rules.days?.includes(d) ? 'bg-relantern-500 text-white shadow-md transform scale-105' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                            {d.charAt(0)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shift Start</label>
                    <input type="time" value={rules.startTime} onChange={e => onChange({ ...contact, labourRules: { ...rules, startTime: e.target.value } })} className="w-full border-slate-300 rounded-md text-sm p-2" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shift End</label>
                    <input type="time" value={rules.endTime} onChange={e => onChange({ ...contact, labourRules: { ...rules, endTime: e.target.value } })} className="w-full border-slate-300 rounded-md text-sm p-2" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hours / Day</label>
                    <input type="number" value={rules.dailyHours} onChange={e => onChange({ ...contact, labourRules: { ...rules, dailyHours: Number(e.target.value) } })} className="w-full border-slate-300 rounded-md text-sm p-2" />
                </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
                <div className="flex gap-3 items-center text-sm text-slate-600">
                    <Clock size={16} />
                    <span>Calculated Capacity: <strong>{(rules.days?.length || 0) * (rules.dailyHours || 0)} hours / week</strong></span>
                </div>
            </div>
        </div>
    );
};

// --- JOURNALS TAB ---
export const JournalsTab: React.FC<{ contact: Contact }> = ({ contact }) => {
    const [entries, setEntries] = useState<JournalEntry[]>([]);

    useEffect(() => {
        DatabaseService.getInstance().getJournalEntries(contact.id, 'CONTACT').then(setEntries);
    }, [contact.id]);

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <input className="flex-1 text-sm border border-slate-300 rounded-md p-2" placeholder="Write a note..."
                    onKeyDown={async e => {
                        if (e.key === 'Enter' && e.currentTarget.value) {
                            await DatabaseService.getInstance().addJournalEntry(contact.id, 'CONTACT', { type: 'NOTE', description: e.currentTarget.value, createdBy: 'system' });
                            e.currentTarget.value = '';
                            DatabaseService.getInstance().getJournalEntries(contact.id, 'CONTACT').then(setEntries);
                        }
                    }} />
            </div>
            <div className="space-y-4">
                {entries.map(e => (
                    <div key={e.id} className="flex gap-3">
                        <div className="mt-1 h-2 w-2 rounded-full bg-slate-300 flex-shrink-0" />
                        <div>
                            <div className="text-xs text-slate-400 mb-0.5">{new Date(e.createdAt).toLocaleString()} • {e.createdBy}</div>
                            <div className="text-sm text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100">{e.description}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- CHILDREN TAB (Placeholder) ---
export const ChildrenTab: React.FC<{ contact: Contact, allContacts: Contact[], onSelect: (c: Contact) => void }> = ({ contact, allContacts, onSelect }) => {
    const children = allContacts.filter(c => c.parentId === contact.id);
    return (
        <div className="space-y-2">
            {children.map(c => (
                <div key={c.id} onClick={() => onSelect(c)} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between hover:bg-blue-50 cursor-pointer">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <ExternalLink size={14} className="text-slate-400" />
                </div>
            ))}
            {children.length === 0 && <div className="text-center italic text-slate-400 py-8">No sub-contacts found.</div>}
        </div>
    );
};

// --- JOBS TAB (Placeholder) ---
export const JobsTab: React.FC<{ contact: Contact }> = ({ contact }) => (
    <div className="text-center py-10 text-slate-400 italic">No associated work orders found for this contact.</div>
);


