
import React, { useState, useEffect } from 'react';
import { X, Shield, Key, Network } from 'lucide-react';
import { Contact, DictionaryEntry, OrganizationUnit } from '../../types';
import { DatabaseService } from '../../services/DatabaseService';

interface AddContactModalProps {
    onClose: () => void;
    onSave: (c: Contact) => void;
    contactTypes: DictionaryEntry[];
    costCenters: DictionaryEntry[];
    initialType?: string; // Auto-select type if provided
    existingUser?: { id: string, username: string, email: string }; // For linking to Virtual Contact
}

export const AddContactModal: React.FC<AddContactModalProps> = ({ onClose, onSave, contactTypes, costCenters, initialType, existingUser }) => {
    const [formData, setFormData] = useState({
        code: '', firstName: '', lastName: '', title: '', email: '', type: initialType || 'INTERNAL',
        orgUnitId: '', costCenterId: ''
    });
    const [userCreds, setUserCreds] = useState({ username: '', password: '' });
    const [createUser, setCreateUser] = useState(true);
    const [createLoading, setCreateLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [orgUnits, setOrgUnits] = useState<OrganizationUnit[]>([]);

    useEffect(() => {
        loadOrgUnits();
        if (existingUser) {
            setFormData(prev => ({
                ...prev,
                code: existingUser.username, // Use username as code
                email: existingUser.email,
                firstName: existingUser.username, // Best guess
                type: 'INTERNAL'
            }));
            setCreateUser(false); // User exists
            setUserCreds(prev => ({ ...prev, username: existingUser.username }));
        }
    }, [existingUser]);

    const loadOrgUnits = async () => {
        const units = await DatabaseService.getInstance().getOrgUnits();
        setOrgUnits(units);
    };

    // Auto-disable user creation for Manufacturers/Vendors by default
    useEffect(() => {
        if (existingUser) return; // Don't override if handling existing user
        const selectedType = contactTypes.find(t => t.code === formData.type);
        if (selectedType?.isManufacturer || selectedType?.code === 'VENDOR') {
            setCreateUser(false);
        } else {
            setCreateUser(true); // Default to true for internal staff
        }
    }, [formData.type, contactTypes, existingUser]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setCreateLoading(true);

        try {
            if (createUser && (!formData.code || !userCreds.password)) {
                throw new Error("Username and Password are required for System Access.");
            }

            const db = DatabaseService.getInstance();

            // Check if username already exists
            if (createUser && formData.code) {
                const existingUsers = await db.getUsers();
                const usernameExists = existingUsers.some(u =>
                    u.username?.toLowerCase() === formData.code.toLowerCase()
                );
                if (usernameExists) {
                    throw new Error(`Username "${formData.code}" is already taken. Please choose a different username.`);
                }
            }

            // Use standard UUID to satisfy Postgres requirements
            const contactId = self.crypto.randomUUID();

            // 1. Create Contact Object (minimal — details filled on the details page)
            const newContact: Contact = {
                id: contactId,
                name: formData.code, // Will be updated with first/last name on details page
                firstName: '',
                lastName: '',
                title: formData.title,
                code: formData.code,
                email: '',
                phone: '', mobile: '', active: true,
                types: ['INTERNAL'], defaultType: 'INTERNAL',
                organizationUnitId: null,
                costCenterId: undefined,
                hourlyRate: 85, currency: 'USD',
                address: { street: '', city: '', state: '', zip: '', country: 'USA' },
                flags: {
                    canLogin: createUser || !!existingUser,
                    canSubmitRequests: true,
                    canLogTime: true,
                    isLabour: true,
                    hasQualifications: false,
                    isVendor: false
                }
            };

            // 2. Add Contact FIRST (so linking trigger works)
            await db.addContact(newContact);

            // 3. Create User OR Link Existing
            if (existingUser) {
                // Link existing user to this new contact
                await db.updateUser(existingUser.id, { contact_id: contactId });
            } else if (createUser) {
                // For users, we ideally want the Edge Function to generate the ID (Auth ID)
                // But we pass a UUID as a placeholder or specific ID if allowed.
                // Let's generate a UUID for strict typing, though Edge Function might override it.
                const userId = self.crypto.randomUUID();

                // If email is empty, generate a unique placeholder to avoid unique constraint violation
                const userEmail = formData.email || `${formData.code}+${Date.now()}@noemail.local`;

                console.log('[AddContactModal] Creating user with:', { username: formData.code, email: userEmail });

                await db.createUser({
                    id: userId,
                    username: formData.code, // Use code as username (single source of truth)
                    email: userEmail,
                    contact_id: contactId,
                    status: 'active',
                    roles: [formData.type], // Use selected type as role
                    password: userCreds.password, // This property is not in User type but passed to Service
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                } as any); // Password already in object
            }

            onSave(newContact);
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setCreateLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="text-lg font-bold text-slate-900">Add New Person / Entity</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200 flex items-center gap-2">
                            <Shield size={16} /> {error}
                        </div>
                    )}

                    {/* Username / Code */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Username <span className="text-red-500">*</span></label>
                        <input
                            required
                            className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-relantern-500 focus:border-blue-500 font-mono"
                            value={formData.code || ''}
                            onChange={e => setFormData({ ...formData, code: e.target.value })}
                            placeholder="e.g. jdoe, EMP-001"
                        />
                    </div>

                    {/* Description (previously Title/Job Role) */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Description <span className="text-red-500">*</span></label>
                        <input
                            required
                            className="w-full text-sm border-slate-300 rounded-md p-2"
                            value={formData.title}
                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                            placeholder="e.g. Senior Technician, Maintenance Lead"
                        />
                    </div>


                    {/* Fields moved to details page: First Name, Last Name, Email, Role/Type, Cost Center */}

                    {/* Organization Unit removed - assign via Admin module instead */}

                    {/* System Access Toggle */}
                    {
                        !existingUser && (
                            <div className="pt-4 border-t border-slate-100">
                                <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="rounded text-blue-600 focus:ring-relantern-500"
                                        checked={createUser}
                                        onChange={e => setCreateUser(e.target.checked)}
                                    />
                                    <span className="text-sm font-medium text-slate-700">Create Account</span>
                                </label>

                                {createUser && (
                                    <div className="bg-slate-50 p-4 rounded-lg space-y-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                                            <input
                                                type="password"
                                                required={createUser}
                                                className="w-full text-sm border-slate-300 rounded-md p-2"
                                                value={userCreds.password}
                                                onChange={e => setUserCreds({ ...userCreds, password: e.target.value })}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    }

                    {
                        existingUser && (
                            <div className="pt-4 border-t border-slate-100">
                                <div className="bg-green-50 p-4 rounded-lg flex items-start gap-3">
                                    <Network className="text-green-600 mt-0.5" size={16} />
                                    <div>
                                        <h4 className="text-sm font-bold text-green-900">System Access Active</h4>
                                        <p className="text-xs text-green-700 mt-1">
                                            This profile will be linked to existing user <strong>@{existingUser.username}</strong>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )
                    }

                    <div className="pt-4 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-relantern-500 text-white rounded-md text-sm font-medium hover:bg-relantern-600 shadow-sm"
                        >
                            Create Record
                        </button>
                    </div>
                </form >
            </div >
        </div >
    );
};
