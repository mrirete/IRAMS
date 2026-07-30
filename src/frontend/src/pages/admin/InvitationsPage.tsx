/**
 * InvitationsPage — Admin › Invitations
 *
 * Manage colleague invites: create (email/phone + role → shareable one-time
 * link), track status (pending / accepted / revoked / expired), copy links,
 * and revoke. Table writes are admin-only under RLS (0190); creation goes
 * through the create_user_invite RPC.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    UserPlus, Copy, Check, Ban, Mail, Phone, RefreshCw, Send, Loader2,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useToast } from '../../eam/contexts/ToastContext';
import { useConfirm } from '../../eam/contexts/ConfirmContext';
import {
    InviteColleagueModal, INVITE_ROLES, inviteLinkFor,
} from '../../eam/components/modals/InviteColleagueModal';

interface InviteRow {
    id: string;
    token: string;
    email: string | null;
    phone: string | null;
    invited_name: string | null;
    role: string;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    invited_by: string | null;
    expires_at: string;
    accepted_at: string | null;
    created_at: string;
}

const STATUS_CHIP: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    accepted: 'bg-green-50 text-green-700 border-green-200',
    revoked: 'bg-slate-100 text-slate-500 border-slate-200',
    expired: 'bg-slate-100 text-slate-500 border-slate-200',
};

/** An overdue pending invite reads as expired without waiting for a DB sweep. */
const effectiveStatus = (inv: InviteRow): InviteRow['status'] =>
    inv.status === 'pending' && new Date(inv.expires_at) <= new Date() ? 'expired' : inv.status;

/**
 * One derivation feeding both the desktop table and the phone card list, so the
 * two renderings cannot drift into disagreeing about the same invite.
 */
const inviteView = (inv: InviteRow, inviterNames: Record<string, string>) => {
    const status = effectiveStatus(inv);
    return {
        status,
        isLive: status === 'pending',
        name: inv.invited_name || inv.email || inv.phone || '—',
        roleLabel: INVITE_ROLES.find(r => r.code === inv.role)?.label || inv.role,
        inviter: inv.invited_by ? (inviterNames[inv.invited_by] || '—') : '—',
        when: status === 'accepted' && inv.accepted_at
            ? `Joined ${new Date(inv.accepted_at).toLocaleDateString()}`
            : new Date(inv.expires_at).toLocaleDateString(),
    };
};

export const InvitationsPage: React.FC = () => {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [invites, setInvites] = useState<InviteRow[]>([]);
    const [inviterNames, setInviterNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('user_invites')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            showToast(`Could not load invitations: ${error.message}`, 'error');
        } else {
            setInvites((data || []) as InviteRow[]);
            const inviterIds = [...new Set((data || []).map((i: any) => i.invited_by).filter(Boolean))];
            if (inviterIds.length > 0) {
                const { data: users } = await supabase.from('users').select('id, username').in('id', inviterIds);
                setInviterNames(Object.fromEntries((users || []).map((u: any) => [u.id, u.username])));
            }
        }
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const copyLink = async (inv: InviteRow) => {
        try {
            await navigator.clipboard.writeText(inviteLinkFor(inv.token));
            setCopiedId(inv.id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch {
            showToast('Could not access the clipboard.', 'error');
        }
    };

    const revoke = async (inv: InviteRow) => {
        const ok = await confirm({
            title: 'Revoke this invite?',
            message: `The link sent to ${inv.invited_name || inv.email || inv.phone} will stop working immediately.`,
            confirmLabel: 'Revoke',
            variant: 'danger',
        });
        if (!ok) return;
        setRevokingId(inv.id);
        const { error } = await supabase
            .from('user_invites')
            .update({ status: 'revoked', updated_at: new Date().toISOString() })
            .eq('id', inv.id);
        setRevokingId(null);
        if (error) {
            showToast(`Could not revoke: ${error.message}`, 'error');
        } else {
            showToast('Invite revoked.', 'success');
            load();
        }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm">
            {/* ── Header ──
                 Stacks on a phone. Side by side, the title wrapped to three lines
                 while "Invite Colleague" was squeezed and clipped off the right
                 edge — the one action the page exists for. */}
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
                        <Send size={20} className="text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Invitations</h1>
                        <p className="text-[12.5px] sm:text-sm text-slate-500 font-medium">Invite colleagues by email or phone — they set up their own login</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={load}
                        className="p-2 h-10 w-10 sm:h-9 sm:w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 shrink-0"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex-1 sm:flex-none px-4 h-10 sm:h-9 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-500 shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                        <UserPlus size={16} /> Invite Colleague
                    </button>
                </div>
            </div>

            {/* ── List ── */}
            <div className="flex-1 overflow-y-auto">
                {loading && invites.length === 0 ? (
                    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                        <Loader2 size={16} className="animate-spin mr-2" /> Loading invitations…
                    </div>
                ) : invites.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                        <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mb-4">
                            <Send size={22} className="text-amber-500" />
                        </div>
                        <h2 className="text-base font-bold text-slate-800">No invitations yet</h2>
                        <p className="text-sm text-slate-500 mt-1 max-w-sm">
                            Invite a colleague by email or phone. They'll get a one-time link to create
                            their own username and password, with the role you assign.
                        </p>
                        <button
                            onClick={() => setShowModal(true)}
                            className="mt-5 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-500 shadow-sm flex items-center gap-2"
                        >
                            <UserPlus size={16} /> Invite Colleague
                        </button>
                    </div>
                ) : (
                    <>
                    {/* ── Phone: one card per invite ──
                         A six-column table at 390px put Role, Status and both
                         actions behind a sideways scroll inside a scrolling page.
                         Cards keep every field and both buttons on screen. */}
                    <ul className="sm:hidden divide-y divide-slate-100">
                        {invites.map(inv => {
                            const v = inviteView(inv, inviterNames);
                            return (
                                <li key={inv.id} className="px-4 py-3.5">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-semibold text-slate-800 text-[14px] truncate">{v.name}</div>
                                            <div className="text-[12px] text-slate-500 mt-1 space-y-0.5">
                                                {inv.email && <div className="flex items-center gap-1.5 truncate"><Mail size={11} className="shrink-0" />{inv.email}</div>}
                                                {inv.phone && <div className="flex items-center gap-1.5"><Phone size={11} className="shrink-0" />{inv.phone}</div>}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold capitalize ${STATUS_CHIP[v.status]}`}>
                                            {v.status}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
                                        <span className="font-medium text-slate-600">{v.roleLabel}</span>
                                        <span className="text-slate-300">·</span>
                                        <span>{v.status === 'accepted' ? v.when : `Expires ${v.when}`}</span>
                                        {v.inviter !== '—' && <><span className="text-slate-300">·</span><span>by {v.inviter}</span></>}
                                    </div>
                                    {v.isLive && (
                                        <div className="mt-3 flex gap-2">
                                            <button
                                                onClick={() => copyLink(inv)}
                                                className="flex-1 h-10 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-700 active:bg-slate-50 inline-flex items-center justify-center gap-1.5"
                                            >
                                                {copiedId === inv.id
                                                    ? <><Check size={14} className="text-green-600" /> Copied</>
                                                    : <><Copy size={14} /> Copy link</>}
                                            </button>
                                            <button
                                                onClick={() => revoke(inv)}
                                                disabled={revokingId === inv.id}
                                                className="h-10 px-4 rounded-lg border border-red-200 text-[13px] font-semibold text-red-600 active:bg-red-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                                            >
                                                {revokingId === inv.id
                                                    ? <Loader2 size={14} className="animate-spin" />
                                                    : <Ban size={14} />}
                                                Revoke
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>

                    <table className="w-full text-sm hidden sm:table">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                            <tr className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                                <th className="px-6 py-3">Invitee</th>
                                <th className="px-4 py-3">Role</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Invited By</th>
                                <th className="px-4 py-3">Expires</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {invites.map(inv => {
                                const status = effectiveStatus(inv);
                                const isLive = status === 'pending';
                                return (
                                    <tr key={inv.id} className="hover:bg-slate-50/60">
                                        <td className="px-6 py-3">
                                            <div className="font-semibold text-slate-800">
                                                {inv.invited_name || inv.email || inv.phone}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                                                {inv.email && <span className="flex items-center gap-1"><Mail size={11} />{inv.email}</span>}
                                                {inv.phone && <span className="flex items-center gap-1"><Phone size={11} />{inv.phone}</span>}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 font-medium">
                                            {INVITE_ROLES.find(r => r.code === inv.role)?.label || inv.role}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold capitalize ${STATUS_CHIP[status]}`}>
                                                {status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500">
                                            {inv.invited_by ? (inviterNames[inv.invited_by] || '—') : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500">
                                            {status === 'accepted' && inv.accepted_at
                                                ? `Joined ${new Date(inv.accepted_at).toLocaleDateString()}`
                                                : new Date(inv.expires_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {isLive && (
                                                    <>
                                                        <button
                                                            onClick={() => copyLink(inv)}
                                                            className="px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
                                                            title="Copy invite link"
                                                        >
                                                            {copiedId === inv.id
                                                                ? <><Check size={12} className="text-green-600" /> Copied</>
                                                                : <><Copy size={12} /> Copy Link</>}
                                                        </button>
                                                        <button
                                                            onClick={() => revoke(inv)}
                                                            disabled={revokingId === inv.id}
                                                            className="px-2.5 py-1.5 rounded-md border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-50"
                                                            title="Revoke invite"
                                                        >
                                                            {revokingId === inv.id
                                                                ? <Loader2 size={12} className="animate-spin" />
                                                                : <Ban size={12} />}
                                                            Revoke
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    </>
                )}
            </div>

            {showModal && (
                <InviteColleagueModal
                    onClose={() => setShowModal(false)}
                    onCreated={() => load()}
                />
            )}
        </div>
    );
};
