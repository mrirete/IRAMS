
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
        orgUnitId: '', costCenterId: '', country: '', phone: ''
    });
    // Manufacturer mode (UAT F-003): a manufacturer is a business partner, NOT a
    // person — render manufacturer fields, suppress username/password, and store it
    // typed as MANUFACTURER (the old form hardcoded types:['INTERNAL']).
    const isMfr = initialType === 'MANUFACTURER' || formData.type === 'MANUFACTURER' || formData.type === 'VENDOR';
    const [userCreds, setUserCreds] = useState({ username: '', password: '', confirmPassword: '' });
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
            // ── Manufacturer (business partner) — no user account, typed MANUFACTURER ──
            if (isMfr) {
                if (!formData.code.trim()) throw new Error('Manufacturer name is required.');
                const mfrId = self.crypto.randomUUID();
                const mfr = {
                    id: mfrId,
                    name: formData.code.trim(),
                    firstName: '', lastName: '',
                    title: 'Manufacturer',
                    code: formData.code.trim(),
                    email: formData.email || '',
                    phone: formData.phone || '', mobile: '', active: true,
                    types: ['MANUFACTURER'], defaultType: 'MANUFACTURER',
                    organizationUnitId: null,
                    costCenterId: undefined,
                    hourlyRate: 0, currency: 'USD',
                    address: { street: '', city: '', state: '', zip: '', country: formData.country || '' },
                    flags: {
                        canLogin: false, canSubmitRequests: false, canLogTime: false,
                        isLabour: false, hasQualifications: false, isVendor: true,
                    },
                } as Contact;
                await DatabaseService.getInstance().addContact(mfr);
                onSave(mfr);
                onClose();
                return;
            }

            if (createUser && (!formData.code || !userCreds.password)) {
                throw new Error("Username and Password are required for System Access.");
            }
            if (createUser && userCreds.password !== userCreds.confirmPassword) {
                throw new Error("Passwords do not match. Please re-enter your password.");
            }
            if (createUser && userCreds.password.length < 6) {
                throw new Error("Password must be at least 6 characters long.");
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

                // The auth-login email MUST match the virtual-email convention the Login
                // screen derives from the username (see Login.tsx → loginWithUsername):
                //   `${username.toLowerCase()}@cainergy.com`
                // Using the contact's personal email (or a noemail.local placeholder) here
                // registers the Supabase Auth account under an address the login flow never
                // tries, so the new user can never sign in. The contact's real email is still
                // stored separately on the contact record below.
                const userEmail = `${formData.code.toLowerCase()}@cainergy.com`;

                console.log('[AddContactModal] Creating user with:', { username: formData.code, email: userEmail });

                await db.createUser({
                    id: userId,
                    username: formData.code, // Use code as username (single source of truth)
                    email: userEmail,
                    contact_id: contactId,
                    status: 'active',
                    roles: [formData.type], // Use selected type as role
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                } as any, userCreds.password); // password MUST be the 2nd arg — that's what routes
                                               // through the secure create_auth_user RPC that actually
                                               // creates the auth.users record. Passing it inside the
                                               // object leaves it undefined and no auth account is made.
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
                    <h3 className="text-lg font-bold text-slate-900">{isMfr ? 'Add New Manufacturer' : 'Add New Person / Entity'}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200 flex items-center gap-2">
                            <Shield size={16} /> {error}
                        </div>
                    )}

                    {isMfr ? (
                    <>
                        {/* ── Manufacturer (business partner) fields ── */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Manufacturer Name <span className="text-red-500">*</span></label>
                            <input
                                required
                                className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                                value={formData.code || ''}
                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                placeholder="e.g. Siemens, GE, ABB"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Country of Origin</label>
                                <input
                                    className="w-full text-sm border-slate-300 rounded-md p-2"
                                    value={formData.country}
                                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                                    placeholder="e.g. Germany"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Phone</label>
                                <input
                                    className="w-full text-sm border-slate-300 rounded-md p-2"
                                    value={formData.phone}
                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="Contact number"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Contact Email</label>
                            <input
                                type="email"
                                className="w-full text-sm border-slate-300 rounded-md p-2"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="sales@manufacturer.com"
                            />
                        </div>
                        <p className="text-[11px] text-slate-400">Saved as a manufacturer business partner. More details (website, models, notes) can be added from its record.</p>
                    </>
                    ) : (
                    <>
                    {/* Username / Code */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Username <span className="text-red-500">*</span></label>
                        <input
                            required
                            autoComplete="off"
                            name="new-person-username"
                            className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500 font-mono"
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
                                        className="rounded text-blue-600 focus:ring-primary-500"
                                        checked={createUser}
                                        onChange={e => setCreateUser(e.target.checked)}
                                    />
                                    <span className="text-sm font-medium text-slate-700">Create Account</span>
                                </label>

                                {createUser && (
                                    <div className="bg-slate-50 p-4 rounded-lg space-y-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password <span className="text-red-500">*</span></label>
                                            <input
                                                type="password"
                                                required={createUser}
                                                autoComplete="new-password"
                                                name="new-account-password"
                                                className="w-full text-sm border-slate-300 rounded-md p-2"
                                                value={userCreds.password}
                                                onChange={e => setUserCreds({ ...userCreds, password: e.target.value })}
                                                placeholder="Enter password"
                                                minLength={6}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Confirm Password <span className="text-red-500">*</span></label>
                                            <input
                                                type="password"
                                                required={createUser}
                                                autoComplete="new-password"
                                                name="confirm-new-account-password"
                                                className={`w-full text-sm rounded-md p-2 ${
                                                    userCreds.confirmPassword && userCreds.password !== userCreds.confirmPassword
                                                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                                                        : 'border-slate-300 focus:ring-primary-500 focus:border-blue-500'
                                                }`}
                                                value={userCreds.confirmPassword}
                                                onChange={e => setUserCreds({ ...userCreds, confirmPassword: e.target.value })}
                                                placeholder="Re-enter password"
                                                minLength={6}
                                            />
                                            {userCreds.confirmPassword && userCreds.password !== userCreds.confirmPassword && (
                                                <p className="text-xs text-red-500 mt-1 font-medium">Passwords do not match</p>
                                            )}
                                            {userCreds.confirmPassword && userCreds.password === userCreds.confirmPassword && userCreds.password.length >= 6 && (
                                                <p className="text-xs text-green-600 mt-1 font-medium">✓ Passwords match</p>
                                            )}
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
                    </>
                    )}

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
                            className="px-6 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm"
                        >
                            Create Record
                        </button>
                    </div>
                </form >
            </div >
        </div >
    );
};
