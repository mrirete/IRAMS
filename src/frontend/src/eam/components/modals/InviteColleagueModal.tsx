/**
 * InviteColleagueModal — invite a colleague by email and/or phone.
 *
 * Two steps: (1) who + role → create_user_invite RPC mints a one-time token,
 * (2) share the /invite/<token> link via Email (mailto), SMS, WhatsApp, or
 * copy — no mail server required; the link itself is the credential and the
 * invitee self-serves username/password on the accept page.
 */
import React, { useState } from 'react';
import { X, UserPlus, Shield, Loader2, Mail, MessageSquare, Copy, Check, Link2, Phone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

export interface CreatedInvite {
    id: string;
    token: string;
    email: string | null;
    phone: string | null;
    invited_name: string | null;
    role: string;
    expires_at: string;
}

// Invitable roles — SUPER_ADMIN deliberately excluded (promote explicitly).
export const INVITE_ROLES: { code: string; label: string }[] = [
    { code: 'TECHNICIAN', label: 'Technician' },
    { code: 'REQUESTER', label: 'Requester' },
    { code: 'PLANNER', label: 'Planner' },
    { code: 'SUPERVISOR', label: 'Supervisor' },
    { code: 'RELIABILITY_ENG', label: 'Reliability Engineer' },
    { code: 'ASSET_MANAGER', label: 'Asset Manager' },
    { code: 'MANAGER', label: 'Manager' },
    { code: 'EXECUTIVE', label: 'Executive' },
    { code: 'SYS_ADMIN', label: 'System Administrator' },
];

export const inviteLinkFor = (token: string) => `${window.location.origin}/invite/${token}`;

const inviteMessage = (link: string, name?: string | null) =>
    `Hi${name ? ` ${name.split(' ')[0]}` : ''}, you've been invited to join IREAMS (Integrated Reliability and Enterprise Management System). ` +
    `Set up your account here: ${link}`;

interface InviteColleagueModalProps {
    onClose: () => void;
    onCreated?: (invite: CreatedInvite) => void;
}

export const InviteColleagueModal: React.FC<InviteColleagueModalProps> = ({ onClose, onCreated }) => {
    const { showToast } = useToast();
    const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'TECHNICIAN' });
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [invite, setInvite] = useState<CreatedInvite | null>(null);
    const [copied, setCopied] = useState(false);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!form.email.trim() && !form.phone.trim()) {
            setError('Enter an email address or a phone number — at least one way to reach them.');
            return;
        }
        setCreating(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('create_user_invite', {
                p_email: form.email.trim() || null,
                p_phone: form.phone.trim() || null,
                p_name: form.name.trim() || null,
                p_role: form.role,
            });
            if (rpcError) throw new Error(rpcError.message);
            const created = data as CreatedInvite;
            setInvite(created);
            onCreated?.(created);
        } catch (err: any) {
            setError(err.message || 'Could not create the invite.');
        } finally {
            setCreating(false);
        }
    };

    const link = invite ? inviteLinkFor(invite.token) : '';
    const message = invite ? inviteMessage(link, invite.invited_name) : '';
    const waPhone = invite?.phone?.replace(/[^0-9]/g, '') || '';

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            showToast('Could not access the clipboard — select and copy the link manually.', 'error');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-2.5">
                        <UserPlus size={18} className="text-primary-600" />
                        <h3 className="text-lg font-bold text-slate-900">{invite ? 'Invite Created' : 'Invite a Colleague'}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                </div>

                {!invite ? (
                    <form onSubmit={handleCreate} className="p-6 overflow-y-auto space-y-4">
                        {error && (
                            <div className="p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200 flex items-center gap-2">
                                <Shield size={16} className="flex-shrink-0" /> {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Name</label>
                            <input
                                className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. Jane Doe (optional — shown on their invite)"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Email</label>
                                <input
                                    type="email"
                                    className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                    placeholder="jane@company.com"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Phone</label>
                                <input
                                    type="tel"
                                    className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                                    value={form.phone}
                                    onChange={e => setForm({ ...form, phone: e.target.value })}
                                    placeholder="+1 555 000 1234"
                                />
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-400 -mt-2">Provide at least one. If an email is set, the account is locked to it.</p>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Role</label>
                            <select
                                className="w-full text-sm border-slate-300 rounded-md p-2 focus:ring-primary-500 focus:border-blue-500"
                                value={form.role}
                                onChange={e => setForm({ ...form, role: e.target.value })}
                            >
                                {INVITE_ROLES.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                            </select>
                        </div>

                        <div className="pt-4 flex justify-end gap-3">
                            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={creating}
                                className="px-6 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {creating && <Loader2 size={16} className="animate-spin" />}
                                {creating ? 'Creating…' : 'Create Invite'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="p-6 overflow-y-auto space-y-4">
                        <div className="p-3.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-start gap-2.5">
                            <Check size={16} className="mt-0.5 flex-shrink-0" />
                            <span>
                                Invite ready for <strong>{invite.invited_name || invite.email || invite.phone}</strong> as{' '}
                                <strong>{INVITE_ROLES.find(r => r.code === invite.role)?.label || invite.role}</strong>.
                                The link works once and expires {new Date(invite.expires_at).toLocaleDateString()}.
                            </span>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Invite Link</label>
                            <div className="flex gap-2">
                                <input
                                    readOnly
                                    className="flex-1 text-xs font-mono border-slate-300 rounded-md p-2 bg-slate-50 text-slate-600"
                                    value={link}
                                    onFocus={e => e.target.select()}
                                />
                                <button
                                    onClick={copyLink}
                                    className="px-3 py-2 rounded-md text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                                >
                                    {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-2">Send Via</label>
                            <div className="grid grid-cols-3 gap-2">
                                <a
                                    href={invite.email ? `mailto:${invite.email}?subject=${encodeURIComponent('Your IREAMS account invite')}&body=${encodeURIComponent(message)}` : undefined}
                                    aria-disabled={!invite.email}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-semibold transition-colors ${invite.email
                                        ? 'border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50'
                                        : 'border-slate-100 text-slate-300 pointer-events-none'}`}
                                >
                                    <Mail size={18} /> Email
                                </a>
                                <a
                                    href={invite.phone ? `sms:${invite.phone}?body=${encodeURIComponent(message)}` : undefined}
                                    aria-disabled={!invite.phone}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-semibold transition-colors ${invite.phone
                                        ? 'border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50'
                                        : 'border-slate-100 text-slate-300 pointer-events-none'}`}
                                >
                                    <MessageSquare size={18} /> SMS
                                </a>
                                <a
                                    href={waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}` : undefined}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-disabled={!waPhone}
                                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-semibold transition-colors ${waPhone
                                        ? 'border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50'
                                        : 'border-slate-100 text-slate-300 pointer-events-none'}`}
                                >
                                    <Phone size={18} /> WhatsApp
                                </a>
                            </div>
                        </div>

                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-500 flex items-start gap-2">
                            <Link2 size={13} className="mt-0.5 flex-shrink-0" />
                            <span>
                                Anyone with this link can create the account, so share it only with the invitee.
                                They'll choose their own username and password; their profile is created with the role you selected.
                            </span>
                        </div>

                        <div className="pt-2 flex justify-end">
                            <button onClick={onClose} className="px-6 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-500 shadow-sm">
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
