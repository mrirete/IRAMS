// Two-factor authentication (TOTP) — enrollment & management (finding F-004,
// risk R-08, SoA 8.5/CC6.6).
//
// Flow: enroll → Supabase returns a QR + secret → user scans in any
// authenticator app → verifies one code → the factor is active. From then on
// Login.tsx demands a code whenever the session's assurance level is below
// what the account can reach (aal1 with a verified factor ⇒ challenge).
// Unenrolling requires an aal2 session, so a stolen password alone cannot
// remove the factor.

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2, Trash2, Copy, Check } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';

type Factor = { id: string; friendly_name?: string; status: 'verified' | 'unverified'; created_at?: string };

export const MFAPanel: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
    const [factors, setFactors] = useState<Factor[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    // enrollment in progress
    const [enrollId, setEnrollId] = useState<string | null>(null);
    const [qr, setQr] = useState('');
    const [secret, setSecret] = useState('');
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error: err } = await supabase.auth.mfa.listFactors();
            if (err) throw err;
            setFactors((data?.totp ?? []) as Factor[]);
        } catch (e: any) {
            setError(e.message || 'Could not load 2FA status');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const startEnroll = async () => {
        setBusy(true); setError('');
        try {
            // A stale unverified factor blocks re-enrollment — clear them first.
            for (const f of factors.filter(f => f.status === 'unverified')) {
                await supabase.auth.mfa.unenroll({ factorId: f.id });
            }
            const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
            if (err) throw err;
            setEnrollId(data.id);
            setQr(data.totp.qr_code);
            setSecret(data.totp.secret);
        } catch (e: any) {
            setError(e.message || 'Enrollment failed');
        } finally {
            setBusy(false);
        }
    };

    const confirmEnroll = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!enrollId || code.length < 6) return;
        setBusy(true); setError('');
        try {
            const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollId, code: code.trim() });
            if (err) throw err;
            setEnrollId(null); setQr(''); setSecret(''); setCode('');
            await refresh();
        } catch (e: any) {
            setError(e.message || 'That code was not accepted — check the app and try again.');
        } finally {
            setBusy(false);
        }
    };

    const unenroll = async (factorId: string) => {
        if (!window.confirm('Disable two-factor authentication? Your account falls back to password-only sign-in.')) return;
        setBusy(true); setError('');
        try {
            const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
            if (err) throw err;
            await refresh();
        } catch (e: any) {
            // Typically: session is aal1 (signed in before enrolling) — a fresh
            // sign-in with a code yields aal2, which unenroll requires.
            setError(e.message || 'Could not disable 2FA. Sign out and back in (with your code), then retry.');
        } finally {
            setBusy(false);
        }
    };

    const verified = factors.filter(f => f.status === 'verified');
    const qrSrc = qr.startsWith('data:') ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;

    return (
        <div className="border border-slate-200 rounded-xl p-5 bg-white">
            <div className="flex items-center justify-between mb-1">
                <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    {verified.length > 0
                        ? <ShieldCheck size={18} className="text-emerald-600" />
                        : <ShieldAlert size={18} className={isAdmin ? 'text-red-500' : 'text-amber-500'} />}
                    Two-Factor Authentication (TOTP)
                </h4>
                {verified.length > 0 && (
                    <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">ACTIVE</span>
                )}
            </div>
            <p className="text-sm text-slate-500 mb-4">
                A one-time code from an authenticator app is required at sign-in, on top of your password.
                {isAdmin && verified.length === 0 && (
                    <span className="block mt-1 font-semibold text-red-600">
                        Your account has administrative access — enable 2FA now. Admin accounts are the primary account-takeover target.
                    </span>
                )}
            </p>

            {error && <p className="text-sm text-red-600 font-medium mb-3">{error}</p>}

            {loading ? (
                <Loader2 size={18} className="animate-spin text-slate-400" />
            ) : verified.length > 0 ? (
                <div className="space-y-2">
                    {verified.map(f => (
                        <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                            <div>
                                <p className="text-sm font-semibold text-slate-800">{f.friendly_name || 'Authenticator app'}</p>
                                {f.created_at && <p className="text-[11px] text-slate-400">enrolled {new Date(f.created_at).toLocaleDateString()}</p>}
                            </div>
                            <button onClick={() => unenroll(f.id)} disabled={busy}
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Disable 2FA">
                                <Trash2 size={15} />
                            </button>
                        </div>
                    ))}
                </div>
            ) : enrollId ? (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4 items-start">
                        <img src={qrSrc} alt="Scan with your authenticator app" className="w-40 h-40 border border-slate-200 rounded-lg bg-white" />
                        <div className="text-sm text-slate-600 space-y-2 flex-1">
                            <p className="font-semibold text-slate-800">1. Scan the QR code</p>
                            <p>Use Google Authenticator, Microsoft Authenticator, 1Password, or any TOTP app.</p>
                            <p className="font-semibold text-slate-800 mt-2">Can't scan? Enter the secret manually:</p>
                            <div className="flex items-center gap-2">
                                <code className="text-[11px] bg-slate-100 border border-slate-200 rounded px-2 py-1 break-all">{secret}</code>
                                <button type="button" onClick={() => { navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded">
                                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>
                    </div>
                    <form onSubmit={confirmEnroll} className="flex items-center gap-2">
                        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                               placeholder="123456" inputMode="numeric" autoComplete="one-time-code"
                               className="w-32 text-center tracking-[0.3em] font-mono text-lg border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-300 outline-none" />
                        <button type="submit" disabled={busy || code.length < 6}
                                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition">
                            {busy ? <Loader2 size={15} className="animate-spin" /> : '2. Verify & activate'}
                        </button>
                        <button type="button" onClick={() => { setEnrollId(null); setQr(''); setSecret(''); setCode(''); }}
                                className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                    </form>
                </div>
            ) : (
                <button onClick={startEnroll} disabled={busy}
                        className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : 'Enable 2FA'}
                </button>
            )}
        </div>
    );
};

export default MFAPanel;
