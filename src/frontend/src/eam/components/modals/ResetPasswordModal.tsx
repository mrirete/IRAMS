/**
 * ResetPasswordModal — change a password from inside the app.
 *   • self-service  → supabase.auth.updateUser({ password }) (the logged-in user)
 *   • admin reset   → rpc admin_reset_password(user_id, new_password) (0180),
 *                     guarded by is_admin() server-side.
 * The caller decides which by passing `isSelf`.
 */
import React, { useState } from 'react';
import { X, KeyRound, Eye, EyeOff, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface Props {
    userId: string;       // auth user id (= public.users.id)
    username: string;
    isSelf: boolean;      // current user changing their own password
    onClose: () => void;
}

const MIN = 8;

export const ResetPasswordModal: React.FC<Props> = ({ userId, username, isSelf, onClose }) => {
    const { showToast } = useToast();
    const [pw, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const tooShort = pw.length > 0 && pw.length < MIN;
    const mismatch = confirm.length > 0 && confirm !== pw;
    const canSave = pw.length >= MIN && confirm === pw && !saving;

    const submit = async () => {
        if (!canSave) return;
        setSaving(true); setErr(null);
        try {
            if (isSelf) {
                const { error } = await supabase.auth.updateUser({ password: pw });
                if (error) throw new Error(error.message);
            } else {
                const { error } = await supabase.rpc('admin_reset_password', { p_user_id: userId, p_new_password: pw });
                if (error) throw new Error(error.message);
            }
            setDone(true);
            showToast(isSelf ? 'Your password was changed.' : `Password reset for @${username}.`, 'success');
        } catch (e: any) {
            setErr(e?.message || 'Could not change the password.');
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 flex items-center gap-2 bg-primary-600 text-white">
                    <KeyRound size={18} />
                    <div className="min-w-0">
                        <h3 className="font-bold text-sm leading-tight">{isSelf ? 'Change your password' : 'Reset password'}</h3>
                        <p className="text-[11px] text-white/80 truncate">@{username}</p>
                    </div>
                    <button onClick={onClose} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                </div>

                {done ? (
                    <div className="p-6 text-center">
                        <div className="inline-flex p-3 bg-emerald-50 rounded-xl text-emerald-600 mb-3"><CheckCircle2 size={30} /></div>
                        <p className="text-sm font-semibold text-slate-800">{isSelf ? 'Password changed.' : `Password reset for @${username}.`}</p>
                        <p className="text-xs text-slate-500 mt-1">{isSelf ? 'Use your new password next time you sign in.' : 'Share the new password securely with the user.'}</p>
                        <button onClick={onClose} className="mt-4 px-5 py-2 bg-primary-600 text-white font-semibold rounded-lg text-sm hover:bg-primary-500">Done</button>
                    </div>
                ) : (
                    <div className="p-5 space-y-3">
                        {!isSelf && (
                            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                You're setting a new password for another user. They can sign in with it immediately.
                            </p>
                        )}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">New password</label>
                            <div className="relative">
                                <input type={show ? 'text' : 'password'} value={pw} autoFocus onChange={e => setPw(e.target.value)}
                                    className="w-full p-2.5 pr-9 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 outline-none" />
                                <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                            {tooShort && <p className="text-[11px] text-amber-600 mt-1">At least {MIN} characters.</p>}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Confirm password</label>
                            <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && canSave) submit(); }}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 outline-none" />
                            {mismatch && <p className="text-[11px] text-red-600 mt-1">Passwords don't match.</p>}
                        </div>
                        {err && <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600"><AlertTriangle size={14} /> {err}</div>}
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:bg-slate-50 px-3 py-2 rounded-lg">Cancel</button>
                            <button onClick={submit} disabled={!canSave}
                                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 px-4 py-2 rounded-lg">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                                {isSelf ? 'Change password' : 'Reset password'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
