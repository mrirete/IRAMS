/**
 * AssessmentInvite.tsx — Colleague Invitation Panel
 *
 * Slide-out panel for inviting colleagues to participate in an assessment.
 * Supports:
 *  - Selecting preloaded system users from the Users Module
 *  - Email fallback for external users not in the system
 *  - Viewer and Contributor roles
 *  - Notification dispatch via NotificationService on invite
 *  - Copy-to-clipboard invite link
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Users, X, Mail, Link2, Copy, Check, UserPlus, Clock, CheckCircle2, XCircle, Search, User, ChevronDown, Bell } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { NotificationService } from '../../eam/services/NotificationService';
import type { AssessmentCollaborator } from '../../eam/services/AuditTypes';

/** Lightweight shape for the system-user picker */
interface SystemUser {
    id: string;
    username: string;
    email: string;
    roles: string[];
    contactName?: string;
}

interface Props {
    assessmentId: string | null;
    currentUser: string;
    isOpen: boolean;
    onClose: () => void;
}

export const AssessmentInvite: React.FC<Props> = ({ assessmentId, currentUser, isOpen, onClose }) => {
    // ─── Form state ───────────────────────────────────────
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'viewer' | 'contributor'>('contributor');
    const [collaborators, setCollaborators] = useState<AssessmentCollaborator[]>([]);
    const [sending, setSending] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    // ─── System Users (preloaded from Users Module) ───────
    const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [inviteMode, setInviteMode] = useState<'system' | 'email'>('system');
    const [userSearch, setUserSearch] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedUser, setSelectedUser] = useState<SystemUser | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // ─── Load collaborators ───────────────────────────────
    useEffect(() => {
        if (isOpen && assessmentId) loadCollaborators();
    }, [isOpen, assessmentId]);

    // ─── Load system users ────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const load = async () => {
            try {
                const db = DatabaseService.getInstance();
                const [users, contacts] = await Promise.all([
                    db.getUsers(),
                    db.getContacts(),
                ]);

                const mapped: SystemUser[] = (users || [])
                    .filter((u: any) => u.status !== 'SUSPENDED' && u.id !== currentUser)
                    .map((u: any) => {
                        const linkedContact = contacts.find((c: any) => c.id === u.contact_id || c.id === u.contactId);
                        return {
                            id: u.id,
                            username: u.username,
                            email: u.email || linkedContact?.email || '',
                            roles: u.roles || [],
                            contactName: linkedContact?.name || '',
                        };
                    });

                setSystemUsers(mapped);
                // If no system users, default to email mode
                if (mapped.length === 0) setInviteMode('email');
            } catch (e) {
                console.warn('[AssessmentInvite] Could not load system users:', e);
                setInviteMode('email');
            } finally {
                setUsersLoading(false);
            }
        };
        load();
    }, [isOpen, currentUser]);

    // ─── Click-outside handler for dropdown ───────────────
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedInDropdown = dropdownRef.current?.contains(target);
            const clickedInSearch = searchInputRef.current?.contains(target);
            if (!clickedInDropdown && !clickedInSearch) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // ─── Filtered user list ───────────────────────────────
    const filteredUsers = useMemo(() => {
        if (!userSearch.trim()) return systemUsers;
        const q = userSearch.toLowerCase();
        return systemUsers.filter(u =>
            u.username.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            (u.contactName || '').toLowerCase().includes(q) ||
            u.roles.some(r => r.toLowerCase().includes(q))
        );
    }, [systemUsers, userSearch]);

    // ─── Helpers ──────────────────────────────────────────
    const loadCollaborators = async () => {
        if (!assessmentId) return;
        const { data } = await supabase
            .from('audit_assessment_collaborators')
            .select('*')
            .eq('assessment_id', assessmentId)
            .order('invited_at', { ascending: false });
        if (data) setCollaborators(data.map(mapRecord));
    };

    const mapRecord = (r: any): AssessmentCollaborator => ({
        id: r.id,
        assessmentId: r.assessment_id,
        email: r.email,
        role: r.role,
        status: r.status,
        inviteToken: r.invite_token,
        invitedBy: r.invited_by,
        invitedAt: r.invited_at,
        acceptedAt: r.accepted_at,
    });

    /** Send the invite — works for both system-user and email mode */
    const handleInvite = async () => {
        const inviteEmail = inviteMode === 'system'
            ? selectedUser?.email || ''
            : email.trim().toLowerCase();

        if (!inviteEmail || !assessmentId) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
            setError('Please enter a valid email address');
            return;
        }
        if (collaborators.some(c => c.email.toLowerCase() === inviteEmail.toLowerCase())) {
            setError('This person has already been invited');
            return;
        }

        setSending(true);
        setError('');

        const { data, error: err } = await supabase
            .from('audit_assessment_collaborators')
            .insert({
                assessment_id: assessmentId,
                email: inviteEmail,
                role,
                invited_by: currentUser,
            })
            .select()
            .single();

        if (err) {
            setError('Failed to send invitation');
            console.error('[AssessmentInvite]', err);
        } else if (data) {
            setCollaborators(prev => [mapRecord(data), ...prev]);
            setEmail('');
            setUserSearch('');
            setSelectedUser(null);

            // ─── Notification dispatch ─────────────────────
            // If the invited person is a system user, send them an in-app notification
            const systemUserId = selectedUser?.id || systemUsers.find(u => u.email.toLowerCase() === inviteEmail.toLowerCase())?.id;
            if (systemUserId) {
                try {
                    await NotificationService.notify({
                        recipientId: systemUserId,
                        title: '📋 Assessment Team Invitation',
                        message: `You have been invited to collaborate on a maturity assessment as a ${role}. Click to open it.`,
                        severity: 'INFO',
                        notificationType: 'ASSIGNMENT',
                        module: 'audits',
                        entityId: assessmentId,
                        entityType: 'ASSESSMENT',
                        actionLink: '/audits',
                        actionRequired: role === 'contributor',
                        createdBy: currentUser,
                    });
                    console.log(`[AssessmentInvite] Notification sent to user ${systemUserId}`);
                } catch (notifErr) {
                    console.warn('[AssessmentInvite] Non-critical: notification dispatch failed', notifErr);
                }

                // ─── Auto-grant audits module access ──────────
                // Ensures the invited user can access /audits even if their role
                // template has audits: NO_ACCESS. Uses JSONB merge to preserve
                // existing overrides while adding full audits access.
                try {
                    const fullAuditsAccess = {
                        view: true, create: true, edit: true, delete: true,
                        approve: true, authorize: false, viewCosts: true, assign: false,
                    };
                    // Merge into existing permission_overrides — does not overwrite other module overrides
                    await supabase.rpc('jsonb_deep_merge_permissions', {
                        p_user_id: systemUserId,
                        p_module: 'audits',
                        p_permissions: fullAuditsAccess,
                    }).then(async (rpcResult) => {
                        // If the RPC doesn't exist, fall back to a direct update
                        if (rpcResult.error) {
                            console.warn('[AssessmentInvite] RPC not found, using direct JSONB merge');
                            const { data: userData } = await supabase
                                .from('users')
                                .select('permission_overrides')
                                .eq('id', systemUserId)
                                .single();
                            const existing = (userData?.permission_overrides || {}) as Record<string, any>;
                            existing.audits = fullAuditsAccess;
                            await supabase
                                .from('users')
                                .update({ permission_overrides: existing })
                                .eq('id', systemUserId);
                        }
                    });
                    console.log(`[AssessmentInvite] ✅ Auto-granted audits access to user ${systemUserId}`);
                } catch (permErr) {
                    console.warn('[AssessmentInvite] Non-critical: permission auto-grant failed', permErr);
                }
            }
        }
        setSending(false);
    };

    const selectSystemUser = (user: SystemUser) => {
        setSelectedUser(user);
        setUserSearch(user.contactName || user.username);
        setShowDropdown(false);
        setError('');
    };

    const copyLink = async () => {
        if (!assessmentId) return;
        const link = `${window.location.origin}/audits?open=${assessmentId}`;
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const removeInvite = async (id: string) => {
        await supabase.from('audit_assessment_collaborators').delete().eq('id', id);
        setCollaborators(prev => prev.filter(c => c.id !== id));
    };

    const statusIcon = (status: string) => {
        switch (status) {
            case 'accepted': return <CheckCircle2 size={12} className="text-green-500" />;
            case 'declined': return <XCircle size={12} className="text-red-500" />;
            default: return <Clock size={12} className="text-amber-500" />;
        }
    };

    /** Check if the invited email belongs to a system user (for display) */
    const getSystemUserByEmail = (eml: string) =>
        systemUsers.find(u => u.email.toLowerCase() === eml.toLowerCase());

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

            {/* Panel */}
            <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                            <Users size={18} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">Invite Colleagues</h3>
                            <p className="text-[10px] text-slate-400">Collaborate on this assessment</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    {/* Assessment Link */}
                    <div className="bg-slate-50 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Link2 size={14} className="text-slate-500" />
                            <span className="text-xs font-bold text-slate-600 uppercase">Assessment Link</span>
                        </div>
                        <button
                            onClick={copyLink}
                            className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition-colors"
                        >
                            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-slate-400" />}
                            <span className="text-xs text-slate-500 flex-1 text-left truncate">
                                {copied ? 'Copied to clipboard!' : 'Click to copy shareable link'}
                            </span>
                        </button>
                    </div>

                    {/* ─── Invite Mode Tabs ─────────────────── */}
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <UserPlus size={14} className="text-slate-500" />
                            <span className="text-xs font-bold text-slate-600 uppercase">Add Colleague</span>
                        </div>

                        {/* Tab toggle — only show if system users available */}
                        {systemUsers.length > 0 && (
                            <div className="flex rounded-lg bg-slate-100 p-0.5 mb-3">
                                <button
                                    onClick={() => { setInviteMode('system'); setError(''); setSelectedUser(null); setUserSearch(''); }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                        inviteMode === 'system'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                >
                                    <User size={12} /> System Users
                                </button>
                                <button
                                    onClick={() => { setInviteMode('email'); setError(''); setSelectedUser(null); }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                        inviteMode === 'email'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-400 hover:text-slate-600'
                                    }`}
                                >
                                    <Mail size={12} /> External Email
                                </button>
                            </div>
                        )}

                        {/* ─── System User Picker ──────────── */}
                        {inviteMode === 'system' && (
                            <div className="space-y-2">
                                {/* Full-width search input */}
                                <div className="relative">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={userSearch}
                                        onChange={e => { setUserSearch(e.target.value); setSelectedUser(null); setShowDropdown(true); setError(''); }}
                                        onFocus={() => setShowDropdown(true)}
                                        placeholder="Search by name, username, or description..."
                                        className="input-field !pl-8 text-sm w-full"
                                    />
                                    {selectedUser && (
                                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                            <Check size={14} className="text-green-500" />
                                        </div>
                                    )}
                                </div>

                                {/* Role selector + Invite — compact row */}
                                <div className="flex items-center gap-2">
                                    <select
                                        value={role}
                                        onChange={e => setRole(e.target.value as 'viewer' | 'contributor')}
                                        className="input-field text-[10px] w-20 py-1.5 px-1.5"
                                    >
                                        <option value="contributor">Contrib.</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <button
                                        onClick={handleInvite}
                                        disabled={sending || !selectedUser}
                                        className="px-3 py-1.5 bg-blue-500 text-white font-bold rounded-lg text-[10px] hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-1"
                                    >
                                        {sending ? '...' : <><Bell size={10} /> Invite</>}
                                    </button>
                                    <span className="text-[9px] text-slate-400 ml-auto">⚡ System users receive an in-app notification automatically</span>
                                </div>

                                {/* Dropdown — full width, outside the compressed flex row */}
                                <div className="relative" ref={dropdownRef}>
                                    {showDropdown && !selectedUser && (
                                        <div className="absolute top-0 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto z-20">
                                            {usersLoading ? (
                                                <div className="p-4 text-center">
                                                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-1" />
                                                    <span className="text-xs text-slate-400">Loading users from People module...</span>
                                                </div>
                                            ) : filteredUsers.length === 0 ? (
                                                <div className="p-4 text-center">
                                                    <span className="text-xs text-slate-400">
                                                        {userSearch.trim() ? `No users matching "${userSearch}"` : 'No system users available'}
                                                    </span>
                                                    <button
                                                        onClick={() => { setInviteMode('email'); setEmail(userSearch.includes('@') ? userSearch : ''); }}
                                                        className="block mx-auto mt-1.5 text-[10px] text-blue-500 hover:underline"
                                                    >
                                                        Invite via email instead →
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    {/* Header — shows count from People module */}
                                                    <div className="sticky top-0 bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center justify-between">
                                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                                            {userSearch.trim() ? `Results` : `People Module`}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400">
                                                            {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                    {filteredUsers.map(u => {
                                                        const alreadyInvited = collaborators.some(c => c.email.toLowerCase() === u.email.toLowerCase());
                                                        return (
                                                            <button
                                                                key={u.id}
                                                                disabled={alreadyInvited}
                                                                onClick={() => selectSystemUser(u)}
                                                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                                                    alreadyInvited
                                                                        ? 'opacity-40 cursor-not-allowed bg-slate-50'
                                                                        : 'hover:bg-blue-50/60'
                                                                }`}
                                                            >
                                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-100 flex items-center justify-center shrink-0">
                                                                    <User size={14} className="text-blue-500" />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm text-slate-700 font-medium truncate">
                                                                        {u.contactName || u.username}
                                                                    </p>
                                                                    <p className="text-[10px] text-slate-400 truncate">
                                                                        @{u.username} · {u.email || 'no email'}
                                                                        {u.roles.length > 0 && ` · ${u.roles[0]}`}
                                                                    </p>
                                                                </div>
                                                                {alreadyInvited && (
                                                                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">INVITED</span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Selected user confirmation chip */}
                                {selectedUser && (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200/60">
                                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                                            <User size={11} className="text-blue-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-slate-700 font-medium truncate">
                                                {selectedUser.contactName || selectedUser.username}
                                            </p>
                                            <p className="text-[10px] text-slate-400 truncate">{selectedUser.email}</p>
                                        </div>
                                        <button
                                            onClick={() => { setSelectedUser(null); setUserSearch(''); searchInputRef.current?.focus(); }}
                                            className="text-slate-400 hover:text-red-400 transition-colors"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                )}

                                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <Bell size={9} className="text-blue-400" />
                                    System users receive an in-app notification automatically
                                </p>
                            </div>
                        )}

                        {/* ─── Email Fallback Mode ─────────── */}
                        {inviteMode === 'email' && (
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={e => { setEmail(e.target.value); setError(''); }}
                                        placeholder="colleague@company.com"
                                        className="input-field text-sm"
                                        onKeyDown={e => e.key === 'Enter' && handleInvite()}
                                    />
                                </div>
                                <select
                                    value={role}
                                    onChange={e => setRole(e.target.value as 'viewer' | 'contributor')}
                                    className="input-field text-xs w-28"
                                >
                                    <option value="contributor">Contributor</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                                <button
                                    onClick={handleInvite}
                                    disabled={sending || !email.trim()}
                                    className="px-4 py-2 bg-blue-500 text-white font-bold rounded-lg text-xs hover:bg-blue-600 disabled:opacity-50 transition-colors"
                                >
                                    {sending ? '...' : 'Invite'}
                                </button>
                            </div>
                        )}

                        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                    </div>

                    {/* ─── Collaborators List ───────────────── */}
                    {collaborators.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Users size={14} className="text-slate-500" />
                                <span className="text-xs font-bold text-slate-600 uppercase">
                                    Invited ({collaborators.length})
                                </span>
                            </div>
                            <div className="space-y-2">
                                {collaborators.map(c => {
                                    const sysUser = getSystemUserByEmail(c.email);
                                    return (
                                        <div key={c.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                                sysUser
                                                    ? 'bg-gradient-to-br from-blue-100 to-blue-100'
                                                    : 'bg-blue-100'
                                            }`}>
                                                {sysUser
                                                    ? <User size={14} className="text-blue-500" />
                                                    : <Mail size={14} className="text-blue-500" />
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-slate-700 font-medium truncate">
                                                    {sysUser ? (sysUser.contactName || sysUser.username) : c.email}
                                                </p>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                                    {statusIcon(c.status)}
                                                    <span className="capitalize">{c.status}</span>
                                                    <span>·</span>
                                                    <span className="capitalize">{c.role}</span>
                                                    {sysUser && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="text-blue-400 font-medium">@{sysUser.username}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => removeInvite(c.id)}
                                                className="text-slate-400 hover:text-red-500 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {collaborators.length === 0 && (
                        <div className="text-center py-8">
                            <Users size={32} className="text-slate-200 mx-auto mb-2" />
                            <p className="text-sm text-slate-400">No colleagues invited yet</p>
                            <p className="text-xs text-slate-300 mt-0.5">Search for system users above or share the assessment link</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
