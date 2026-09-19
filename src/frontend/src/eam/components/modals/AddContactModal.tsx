
import React, { useState, useEffect } from 'react';
import { X, Shield, Key, Network, Loader2 } from 'lucide-react';
import { Contact, DictionaryEntry, OrganizationUnit } from '../../types';
import { DatabaseService } from '../../services/DatabaseService';
import { useToast } from '../../contexts/ToastContext';
import { ROLE_PERMISSION_TEMPLATES } from '../../constants/rolePermissions';

/**
 * The system roles a person can be given here — the codes that HAVE a
 * permission template. The CONTACT_TYPE dictionary mixes entity types
 * (INTERNAL, VENDOR, MANUFACTURER) with roles; the form used to write the
 * entity type as the login's role, so every technician started life as
 * INTERNAL (view-only) until an admin noticed. SUPER_ADMIN is never handed
 * out from a form.
 */
const ASSIGNABLE_ROLES = Object.keys(ROLE_PERMISSION_TEMPLATES).filter(r => r !== 'SUPER_ADMIN');
const DEFAULT_ROLE = 'TECHNICIAN';
/** Roles whose holders are, by default, people a planner can put on a job (flags.isLabour). */
const LABOUR_ROLES = new Set(['TECHNICIAN', 'ELECTRICIAN', 'MECHANIC', 'INSTRUMENT', 'OPERATOR', 'SUPERVISOR']);
/** CONTACT_TYPE rows that are business-partner kinds, not crafts a person can hold. */
const NON_CRAFT_CODES = new Set(['VENDOR', 'MANUFACTURER', 'SUPPLIER']);
const FALLBACK_RATE = 85;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddContactModalProps {
    onClose: () => void;
    onSave: (c: Contact) => void;
    contactTypes: DictionaryEntry[];
    costCenters: DictionaryEntry[];
    initialType?: string; // Auto-select type if provided
    existingUser?: { id: string, username: string, email: string }; // For linking to Virtual Contact
}

export const AddContactModal: React.FC<AddContactModalProps> = ({ onClose, onSave, contactTypes, costCenters, initialType, existingUser }) => {
    const { showToast } = useToast();
    const [formData, setFormData] = useState({
        code: '', firstName: '', lastName: '', title: '', email: '', type: initialType || 'INTERNAL',
        role: DEFAULT_ROLE,
        orgUnitId: '', costCenterId: '', country: '', phone: ''
    });
    // Manufacturer mode (UAT F-003): a manufacturer is a business partner, NOT a
    // person — render manufacturer fields, suppress username/password, and store it
    // typed as MANUFACTURER (the old form hardcoded types:['INTERNAL']).
    const isMfr = initialType === 'MANUFACTURER' || formData.type === 'MANUFACTURER' || formData.type === 'VENDOR';
    const [userCreds, setUserCreds] = useState({ username: '', password: '', confirmPassword: '' });
    const [createUser, setCreateUser] = useState(true);

    // Labour attributes. Rate and the schedulable flag follow the chosen role
    // until the admin edits them by hand; craft is an explicit choice.
    const roleRate = (role: string): number => {
        const r = Number(contactTypes.find(t => t.code === role && t.active !== false)?.hourlyRate);
        return Number.isFinite(r) && r > 0 ? r : FALLBACK_RATE;
    };
    const [hourlyRate, setHourlyRate] = useState<string>(String(roleRate(DEFAULT_ROLE)));
    const [rateTouched, setRateTouched] = useState(false);
    const [craft, setCraft] = useState<string>('');
    const [isLabour, setIsLabour] = useState<boolean>(LABOUR_ROLES.has(DEFAULT_ROLE));
    const [labourTouched, setLabourTouched] = useState(false);
    const craftOptions = contactTypes.filter(t => t.active !== false && !t.isManufacturer && !NON_CRAFT_CODES.has(t.code));

    useEffect(() => {
        if (!rateTouched) setHourlyRate(String(roleRate(formData.role)));
        if (!labourTouched) setIsLabour(LABOUR_ROLES.has(formData.role));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.role, contactTypes]);
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
                        isLabour: false, hasQualifications: false, isVendor: true,
                    },
                } as Contact;
                await DatabaseService.getInstance().addContact(mfr);
                showToast(`Manufacturer "${mfr.name}" created.`, 'success');
                onSave(mfr);
                onClose();
                return;
            }

            const email = formData.email.trim().toLowerCase();
            if (email && !EMAIL_RE.test(email)) {
                throw new Error('Enter a valid e-mail address (name@company.com).');
            }
            if (createUser && (!formData.code || !userCreds.password)) {
                throw new Error("Username and Password are required for System Access.");
            }
            if (createUser && !email) {
                // Launch rule: people sign in with their company e-mail. The
                // login is registered under this address, so it must be real.
                throw new Error('An e-mail address is required to create a login — it is what this person signs in with.');
            }
            if (createUser && userCreds.password !== userCreds.confirmPassword) {
                throw new Error("Passwords do not match. Please re-enter your password.");
            }
            if (createUser && userCreds.password.length < 6) {
                throw new Error("Password must be at least 6 characters long.");
            }
            const rate = Number(hourlyRate);
            if (!Number.isFinite(rate) || rate < 0) {
                throw new Error('Hourly rate must be a number of zero or more.');
            }

            const db = DatabaseService.getInstance();

            // Check if username / login e-mail already exists
            if (createUser && formData.code) {
                const existingUsers = await db.getUsers();
                const usernameExists = existingUsers.some(u =>
                    u.username?.toLowerCase() === formData.code.toLowerCase()
                );
                if (usernameExists) {
                    throw new Error(`Username "${formData.code}" is already taken. Please choose a different username.`);
                }
                const emailExists = existingUsers.some(u => (u.email || '').toLowerCase() === email);
                if (emailExists) {
                    throw new Error(`A login already exists for ${email}. Link this person to that account instead.`);
                }
            }

            // The role is the person's system role (permission template) and
            // always leads contacts.roles; the craft is what a labour picker
            // filters on and rides alongside it. Same code twice is one entry.
            const types = craft && craft !== formData.role ? [formData.role, craft] : [formData.role];

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
                email,
                phone: '', mobile: '', active: true,
                // The person's ROLE is what contacts.roles / users.roles carry
                // (Admin → Access Control syncs the two). INTERNAL is an entity
                // type, not a role — writing it here is what gave new
                // technicians a view-only login.
                types, defaultType: formData.role,
                organizationUnitId: null,
                costCenterId: undefined,
                hourlyRate: rate, currency: 'USD',
                address: { street: '', city: '', state: '', zip: '', country: '' },
                flags: {
                    isLabour,
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

                // Launch rule (company-e-mail sign-in): the auth account is
                // registered under the person's real e-mail, which the Login
                // screen accepts directly. The old `<username>@cainergy.com`
                // derivation minted addresses nobody owned.
                const userEmail = email;

                console.log('[AddContactModal] Creating user with:', { username: formData.code, email: userEmail });

                try {
                    await db.createUser({
                        id: userId,
                        username: formData.code, // Use code as username (single source of truth)
                        email: userEmail,
                        contact_id: contactId,
                        status: 'active',
                        roles: [formData.role], // the chosen system role, not the entity type
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    } as any, userCreds.password); // password MUST be the 2nd arg — that's what routes
                                                   // through the secure create_auth_user RPC that actually
                                                   // creates the auth.users record. Passing it inside the
                                                   // object leaves it undefined and no auth account is made.
                } catch (userErr) {
                    // Roll back the contact we created in step 2 — otherwise a failed
                    // account-create leaves an orphaned person (the "duplicate/unlinked"
                    // records we had to clean up). Keep create atomic: person + login,
                    // or neither.
                    try { await db.deleteContact(contactId); } catch (rbErr) { console.warn('[AddContactModal] contact rollback failed:', rbErr); }
                    throw userErr;
                }
            }

            const accountMsg = existingUser
                ? `Linked to existing account @${existingUser.username}.`
                : createUser
                    ? `Person "${formData.code}" created — signs in as ${email}.`
                    : `Person "${formData.code}" created.`;
            showToast(accountMsg, 'success');
            onSave(newContact);
            onClose();
        } catch (err: any) {
            setError(err.message);
            showToast(err.message || 'Could not create record.', 'error');
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


                    {/* System role — drives the permission template for the contact AND the login */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">System Role <span className="text-red-500">*</span></label>
                        <select
                            required
                            className="w-full text-sm border-slate-300 rounded-md p-2 bg-white"
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                        >
                            {ASSIGNABLE_ROLES.map(r => (
                                <option key={r} value={r}>
                                    {contactTypes.find(t => t.code === r)?.description || r.replace(/_/g, ' ')}
                                </option>
                            ))}
                        </select>
                        <p className="text-[11px] text-slate-400 mt-1">Sets what this person can see and do. Fine-tune per person later in Admin → Access Control.</p>
                    </div>

                    {/* E-mail — the login identity when an account is created */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                            E-mail {createUser && !existingUser && <span className="text-red-500">*</span>}
                        </label>
                        <input
                            type="email"
                            required={createUser && !existingUser}
                            autoComplete="off"
                            name="new-person-email"
                            className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="name@company.com"
                            readOnly={!!existingUser}
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                            {existingUser ? 'The e-mail of the linked login.' : createUser ? 'This person signs in with this address.' : 'Optional without a login.'}
                        </p>
                    </div>

                    {/* Craft + rate — what labour pickers and cost rules read */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Craft</label>
                            <select
                                className="w-full text-sm border-slate-300 rounded-md p-2 bg-white"
                                value={craft}
                                onChange={e => setCraft(e.target.value)}
                            >
                                <option value="">— none —</option>
                                {craftOptions.map(t => (
                                    <option key={t.code} value={t.code}>{t.description || t.code}</option>
                                ))}
                            </select>
                            <p className="text-[11px] text-slate-400 mt-1">Trade a planner picks by.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Hourly rate</label>
                            <div className="flex items-center gap-1">
                                <span className="text-sm text-slate-400">$</span>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    inputMode="decimal"
                                    className="w-full text-sm border-slate-300 rounded-md p-2"
                                    value={hourlyRate}
                                    onChange={e => { setRateTouched(true); setHourlyRate(e.target.value); }}
                                />
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                                {rateTouched ? 'Person-specific rate.' : `Standard rate for ${formData.role.replace(/_/g, ' ').toLowerCase()}.`}
                            </p>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="rounded text-blue-600 focus:ring-primary-500"
                            checked={isLabour}
                            onChange={e => { setLabourTouched(true); setIsLabour(e.target.checked); }}
                        />
                        <span className="text-sm text-slate-700">Schedulable labour</span>
                        <span className="text-[11px] text-slate-400">— can be put on work orders and the schedule</span>
                    </label>

                    {/* Fields moved to details page: First Name, Last Name, Cost Center */}

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
                            disabled={createLoading || (createUser && !existingUser && !isMfr && userCreds.password !== userCreds.confirmPassword)}
                            className="px-6 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {createLoading && <Loader2 size={16} className="animate-spin" />}
                            {createLoading ? 'Creating…' : 'Create Record'}
                        </button>
                    </div>
                </form >
            </div >
        </div >
    );
};
