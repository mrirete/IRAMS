/**
 * AcceptInvite — public page at /invite/:token.
 *
 * The invitee opens the link an admin shared (email/SMS/WhatsApp), sees who
 * invited them and as what role, then picks a username + password.
 * accept_invite() (0190) creates the person + auth account + app profile in
 * one transaction, after which we sign them straight in. Runs signed-out —
 * the token in the URL is the authorization.
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    Lock, Mail, User, AtSign, AlertCircle, Loader2, ArrowRight,
    Eye, EyeOff, ShieldCheck, Link2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface InviteInfo {
    found: boolean;
    status?: 'pending' | 'accepted' | 'revoked' | 'expired';
    email?: string | null;
    phone?: string | null;
    invited_name?: string | null;
    role?: string;
    invited_by?: string;
    expires_at?: string;
}

const ROLE_LABELS: Record<string, string> = {
    TECHNICIAN: 'Technician', REQUESTER: 'Requester', PLANNER: 'Planner',
    SUPERVISOR: 'Supervisor', RELIABILITY_ENG: 'Reliability Engineer',
    ASSET_MANAGER: 'Asset Manager',
    MANAGER: 'Manager', EXECUTIVE: 'Executive', SYS_ADMIN: 'System Administrator',
    INTERNAL: 'Team Member',
};

const usernameFromEmail = (email: string) =>
    email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);

export const AcceptInvite: React.FC = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();

    const [invite, setInvite] = useState<InviteInfo | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [form, setForm] = useState({ fullName: '', email: '', username: '', password: '', confirm: '' });
    const [usernameTouched, setUsernameTouched] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!token) { setLoadError(true); return; }
        supabase.rpc('get_invite', { p_token: token }).then(({ data, error: e }) => {
            if (e || !data) { setLoadError(true); return; }
            const info = data as InviteInfo;
            setInvite(info);
            if (info.found && info.status === 'pending') {
                setForm(prev => ({
                    ...prev,
                    fullName: info.invited_name || '',
                    email: info.email || '',
                    username: info.email ? usernameFromEmail(info.email) : '',
                }));
            }
        });
    }, [token]);

    const emailLocked = !!invite?.email;

    const handleEmailChange = (value: string) => {
        setForm(prev => ({
            ...prev,
            email: value,
            // Track the email until the invitee picks their own username.
            username: usernameTouched ? prev.username : (value.includes('@') ? usernameFromEmail(value) : prev.username),
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
        if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
        setSubmitting(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('accept_invite', {
                p_token: token,
                p_username: form.username.trim(),
                p_password: form.password,
                p_full_name: form.fullName.trim(),
                p_email: form.email.trim() || null,
            });
            if (rpcError) throw new Error(rpcError.message);

            const created = data as { user_id: string; email: string };
            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: created.email,
                password: form.password,
            });
            if (signInError) {
                // Account exists; only the auto-login failed — land them on Login.
                navigate('/login', { replace: true });
                return;
            }
            navigate('/', { replace: true });
        } catch (err: any) {
            setError(err.message || 'Could not create your account.');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Shared chrome ──
    const shell = (content: React.ReactNode) => (
        <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
            <header className="flex items-center px-6 sm:px-10 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                         style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z" />
                            <path d="M12 14v4" />
                            <path d="M10 22h4" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-[17px] font-extrabold tracking-tight" style={{ color: '#1e293b' }}>IREAMS</div>
                        <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>by Relantern</div>
                    </div>
                </div>
            </header>
            <div className="flex-1 flex items-center justify-center px-4 py-8">
                <div className="w-full max-w-[460px]">{content}</div>
            </div>
        </div>
    );

    const notice = (title: string, body: string) => shell(
        <div className="rounded-2xl p-8 text-center"
             style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 4px 24px rgba(148, 163, 184, 0.1)' }}>
            <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-4" style={{ background: '#fef3c7' }}>
                <Link2 size={20} style={{ color: '#d97706' }} />
            </div>
            <h1 className="text-[20px] font-extrabold" style={{ color: '#1e293b' }}>{title}</h1>
            <p className="text-[14px] font-medium mt-2" style={{ color: '#64748b' }}>{body}</p>
            <Link to="/login" className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-[14px] font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)' }}>
                Go to Sign In <ArrowRight size={15} />
            </Link>
        </div>
    );

    if (loadError) return notice('Invite not available', 'We could not load this invite. Check the link, or ask your administrator to send a new one.');
    if (!invite) return shell(
        <div className="flex items-center justify-center py-16" style={{ color: '#64748b' }}>
            <Loader2 size={18} className="animate-spin mr-2" /> Checking your invite…
        </div>
    );
    if (!invite.found) return notice('Invite not found', 'This invite link is not valid. Ask your administrator to send you a new one.');
    if (invite.status === 'accepted') return notice('Already set up', 'This invite has already been used. If that was you, just sign in.');
    if (invite.status === 'revoked') return notice('Invite revoked', 'This invite was withdrawn. Ask your administrator for a new one.');
    if (invite.status === 'expired') return notice('Invite expired', 'This invite link has expired. Ask your administrator to send a fresh one.');

    const roleLabel = ROLE_LABELS[invite.role || ''] || invite.role || 'Team Member';

    const fieldStyle = { background: '#f8fafc', border: '1.5px solid #e2e8f0' };

    return shell(
        <>
            <div className="mb-6">
                <h1 className="text-[28px] font-extrabold tracking-tight leading-tight" style={{ color: '#1e293b' }}>
                    Join your team on IREAMS
                </h1>
                <p className="text-[14px] font-medium mt-2" style={{ color: '#64748b' }}>
                    <strong>{invite.invited_by}</strong> invited you to join as{' '}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-bold align-middle"
                          style={{ background: '#fef3c7', color: '#92400e' }}>
                        <ShieldCheck size={12} /> {roleLabel}
                    </span>
                </p>
            </div>

            <div className="rounded-2xl p-7"
                 style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 4px 24px rgba(148, 163, 184, 0.1), 0 1px 4px rgba(148, 163, 184, 0.06)' }}>
                {error && (
                    <div className="mb-5 p-3.5 rounded-xl flex items-start gap-3" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                        <AlertCircle className="flex-shrink-0 mt-0.5" size={17} style={{ color: '#ef4444' }} />
                        <p className="text-[13px] font-medium" style={{ color: '#dc2626' }}>{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: '#334155' }}>Full Name</label>
                        <div className="relative rounded-xl" style={fieldStyle}>
                            <User className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: '#94a3b8' }} />
                            <input
                                type="text" required value={form.fullName}
                                onChange={e => setForm({ ...form, fullName: e.target.value })}
                                className="w-full bg-transparent rounded-xl py-3 pl-11 pr-4 outline-none text-[14px] font-medium"
                                style={{ color: '#1e293b' }} placeholder="Your full name"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: '#334155' }}>
                            Work Email {emailLocked && <span className="text-[11px] font-medium" style={{ color: '#94a3b8' }}>(set by your invite)</span>}
                        </label>
                        <div className="relative rounded-xl" style={{ ...fieldStyle, opacity: emailLocked ? 0.7 : 1 }}>
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: '#94a3b8' }} />
                            <input
                                type="email" required value={form.email} readOnly={emailLocked}
                                onChange={e => handleEmailChange(e.target.value)}
                                className="w-full bg-transparent rounded-xl py-3 pl-11 pr-4 outline-none text-[14px] font-medium"
                                style={{ color: '#1e293b' }} placeholder="you@company.com"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[13px] font-semibold mb-1.5" style={{ color: '#334155' }}>Username</label>
                        <div className="relative rounded-xl" style={fieldStyle}>
                            <AtSign className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: '#94a3b8' }} />
                            <input
                                type="text" required value={form.username}
                                onChange={e => { setUsernameTouched(true); setForm({ ...form, username: e.target.value.toLowerCase() }); }}
                                className="w-full bg-transparent rounded-xl py-3 pl-11 pr-4 outline-none text-[14px] font-medium font-mono"
                                style={{ color: '#1e293b' }} placeholder="e.g. jdoe"
                                pattern="[a-z0-9][a-z0-9._-]{2,31}"
                                title="3-32 characters: lowercase letters, numbers, dots, dashes"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: '#334155' }}>Password</label>
                            <div className="relative rounded-xl" style={fieldStyle}>
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: '#94a3b8' }} />
                                <input
                                    type={showPassword ? 'text' : 'password'} required minLength={6} value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                    autoComplete="new-password"
                                    className="w-full bg-transparent rounded-xl py-3 pl-11 pr-10 outline-none text-[14px] font-medium"
                                    style={{ color: '#1e293b' }} placeholder="Min 6 characters"
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: '#94a3b8' }}>
                                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[13px] font-semibold mb-1.5" style={{ color: '#334155' }}>Confirm</label>
                            <div className="relative rounded-xl" style={fieldStyle}>
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2" size={16} style={{ color: '#94a3b8' }} />
                                <input
                                    type={showPassword ? 'text' : 'password'} required minLength={6} value={form.confirm}
                                    onChange={e => setForm({ ...form, confirm: e.target.value })}
                                    autoComplete="new-password"
                                    className="w-full bg-transparent rounded-xl py-3 pl-11 pr-4 outline-none text-[14px] font-medium"
                                    style={{ color: '#1e293b' }} placeholder="Re-enter"
                                />
                            </div>
                        </div>
                    </div>
                    {form.confirm && form.password !== form.confirm && (
                        <p className="text-[12px] font-medium -mt-2" style={{ color: '#dc2626' }}>Passwords do not match</p>
                    )}

                    <button
                        type="submit"
                        disabled={submitting || (!!form.confirm && form.password !== form.confirm)}
                        className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white flex items-center justify-center gap-2.5 mt-2"
                        style={{
                            background: submitting ? '#92600a' : 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                            boxShadow: submitting ? 'none' : '0 4px 16px rgba(245, 158, 11, 0.3)',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {submitting
                            ? <><Loader2 className="animate-spin" size={18} /> Creating your account…</>
                            : <>Create Account &amp; Sign In <ArrowRight size={16} /></>}
                    </button>
                </form>
            </div>

            <p className="text-[12px] font-medium text-center mt-5" style={{ color: '#94a3b8' }}>
                Already have an account? <Link to="/login" className="font-bold" style={{ color: '#f59e0b' }}>Sign in</Link>
            </p>
        </>
    );
};
