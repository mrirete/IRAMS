
import React, { useState, useEffect } from 'react';
import { X, Shield, Network, Loader2 } from 'lucide-react';
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
    // until the admin edits them by hand. There is no separate craft field:
    // the CONTACT_TYPE dictionary IS the role list, so a "craft" picker showed
    // the same entries a second time. Pickers read the trade from the role.
    const roleRate = (role: string): number => {
        const r = Number(contactTypes.find(t => t.code === role && t.active !== false)?.hourlyRate);
        return Number.isFinite(r) && r > 0 ? r : FALLBACK_RATE;
    };
    const [hourlyRate, setHourlyRate] = useState<string>(String(roleRate(DEFAULT_ROLE)));
    const [rateTouched, setRateTouched] = useState(false);
    const [isLabour, setIsLabour] = useState<boolean>(LABOUR_ROLES.has(DEFAULT_ROLE));
    const [labourTouched, setLabourTouched] = useState(false);

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
            // is what contacts.roles carries; labour pickers read the trade
            // from it too.
            const types = [formData.role];

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

    const mismatch = !!userCreds.confirmPassword && userCreds.password !== userCreds.confirmPassword;
    // One label / input / hint style for the whole form.
    const L = 'block text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1';
    const I = 'w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500';
    const H = 'text-[11px] text-slate-400 mt-1';
    const Req = () => <span className="text-red-500">*</span>;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
                <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-base font-bold text-slate-900">{isMfr ? 'Add Manufacturer' : 'Add Person'}</h3>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                <form id="add-contact-form" onSubmit={handleSubmit} className="px-5 py-4 overflow-y-auto space-y-3.5 ers-dense">
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
                    {/* Who — identity in two rows */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className={L}>Username <Req /></label>
                            <input
                                required
                                autoComplete="off"
                                name="new-person-username"
                                className={`${I} font-mono`}
                                value={formData.code || ''}
                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                placeholder="jdoe"
                            />
                        </div>
                        <div>
                            <label className={L}>Job title <Req /></label>
                            <input
                                required
                                className={I}
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Senior Technician"
                            />
                        </div>
                        <div>
                            <label className={L}>System role <Req /></label>
                            <select
                                required
                                className={`${I} bg-white`}
                                value={formData.role}
                                onChange={e => setFormData({ ...formData, role: e.target.value })}
                            >
                                {ASSIGNABLE_ROLES.map(r => (
                                    <option key={r} value={r}>
                                        {contactTypes.find(t => t.code === r)?.description || r.replace(/_/g, ' ')}
                                    </option>
                                ))}
                            </select>
                            <p className={H}>Controls access. Editable later in Admin.</p>
                        </div>
                        <div>
                            <label className={L}>E-mail {createUser && !existingUser && <Req />}</label>
                            <input
                                type="email"
                                required={createUser && !existingUser}
                                autoComplete="off"
                                name="new-person-email"
                                className={I}
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                placeholder="name@company.com"
                                readOnly={!!existingUser}
                            />
                        </div>
                    </div>

                    {/* Labour — what cost rules and the schedule read */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                        <div>
                            <label className={L}>Hourly rate</label>
                            <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                                <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    inputMode="decimal"
                                    className={`${I} pl-6`}
                                    value={hourlyRate}
                                    onChange={e => { setRateTouched(true); setHourlyRate(e.target.value); }}
                                />
                            </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer h-[38px] px-3 rounded-md border border-slate-200 bg-slate-50">
                            <input
                                type="checkbox"
                                className="rounded text-blue-600 focus:ring-primary-500"
                                checked={isLabour}
                                onChange={e => { setLabourTouched(true); setIsLabour(e.target.checked); }}
                            />
                            <span className="text-sm text-slate-700">Schedulable labour</span>
                        </label>
                    </div>

                    {/* Login */}
                    {!existingUser && (
                        <div className="rounded-lg border border-slate-200 overflow-hidden">
                            <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 bg-slate-50">
                                <input
                                    type="checkbox"
                                    className="rounded text-blue-600 focus:ring-primary-500"
                                    checked={createUser}
                                    onChange={e => setCreateUser(e.target.checked)}
                                />
                                <span className="text-sm font-medium text-slate-700">Create login</span>
                                <span className="text-xs text-slate-400 ml-auto">{createUser ? 'signs in with the e-mail above' : 'record only'}</span>
                            </label>
                            {createUser && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border-t border-slate-200">
                                    <div>
                                        <label className={L}>Password <Req /></label>
                                        <input
                                            type="password"
                                            required={createUser}
                                            autoComplete="new-password"
                                            name="new-account-password"
                                            className={I}
                                            value={userCreds.password}
                                            onChange={e => setUserCreds({ ...userCreds, password: e.target.value })}
                                            placeholder="At least 6 characters"
                                            minLength={6}
                                        />
                                    </div>
                                    <div>
                                        <label className={L}>Confirm <Req /></label>
                                        <input
                                            type="password"
                                            required={createUser}
                                            autoComplete="new-password"
                                            name="confirm-new-account-password"
                                            className={`w-full text-sm rounded-md p-2 ${
                                                mismatch
                                                    ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                                                    : 'border-slate-300 focus:ring-primary-500 focus:border-blue-500'
                                            }`}
                                            value={userCreds.confirmPassword}
                                            onChange={e => setUserCreds({ ...userCreds, confirmPassword: e.target.value })}
                                            placeholder="Re-enter"
                                            minLength={6}
                                        />
                                        {mismatch && <p className="text-xs text-red-500 mt-1 font-medium">Passwords do not match</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {existingUser && (
                        <div className="bg-green-50 p-3 rounded-lg flex items-start gap-3">
                            <Network className="text-green-600 mt-0.5" size={16} />
                            <p className="text-xs text-green-800">
                                Linked to existing login <strong>@{existingUser.username}</strong>.
                            </p>
                        </div>
                    )}
                    </>
                    )}
                </form>

                <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-3 bg-white">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="add-contact-form"
                        disabled={createLoading || (createUser && !existingUser && !isMfr && userCreds.password !== userCreds.confirmPassword)}
                        className="px-5 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {createLoading && <Loader2 size={16} className="animate-spin" />}
                        {createLoading ? 'Creating…' : isMfr ? 'Add manufacturer' : 'Add person'}
                    </button>
                </div>
            </div>
        </div>
    );
};
