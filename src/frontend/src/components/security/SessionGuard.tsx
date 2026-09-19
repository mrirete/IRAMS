/**
 * SessionGuard — makes two Global Settings values real.
 *
 * Until now "Session Timeout" and "MFA Enforcement" were stored on the company
 * record and read by nothing. An administrator could set a 15-minute timeout and
 * switch enforcement on, and the product behaved exactly as it had before. This
 * component is the consumer for both.
 *
 *   Session Timeout   → an idle clock that signs the session out, with a warning
 *                       in the final minute so nobody loses a half-typed form.
 *   MFA Enforcement   → a blocking screen for anyone without a verified TOTP
 *                       factor. They enrol here or they sign out.
 *
 * The enforcement screen is a client-side gate, and the code says so rather than
 * implying more: a determined user with the access token can still call the API
 * directly. Closing that properly means requiring assurance level aal2 in the
 * row-level policies, which is a database change, not a React one. What this
 * gives you today is that the console is unusable without a second factor, which
 * is what the setting has always claimed.
 */
import React from 'react';
import { ShieldAlert, Clock, LogOut } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../eam/contexts/AuthContext';
import { useIdleTimeout } from '../../hooks/useIdleTimeout';
import { supabase } from '../../eam/lib/supabase';
import { MFAPanel } from './MFAPanel';

export const SessionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { settings, loading: settingsLoading } = useSettings();
    const { signOut, user } = useAuth();

    const { warning, secondsLeft, staySignedIn } = useIdleTimeout(
        settings.sessionTimeoutMinutes,
        () => { void signOut(); },
    );

    // ── MFA enforcement ──────────────────────────────────────
    // null = not checked yet. Never block on an unknown: a failed factor lookup
    // must not lock a tenant out of its own workspace.
    const [hasFactor, setHasFactor] = React.useState<boolean | null>(null);

    const enforce = settings.mfaEnforced && !settingsLoading && !!user;

    React.useEffect(() => {
        if (!enforce) { setHasFactor(null); return; }
        let active = true;
        (async () => {
            try {
                const { data, error } = await supabase.auth.mfa.listFactors();
                if (!active) return;
                if (error) { setHasFactor(true); return; }   // fail open, see above
                const verified = (data?.totp ?? []).some((f: { status?: string }) => f.status === 'verified');
                setHasFactor(verified);
            } catch {
                if (active) setHasFactor(true);
            }
        })();
        return () => { active = false; };
    }, [enforce, user?.id]);

    if (enforce && hasFactor === false) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-start sm:items-center justify-center px-4 py-10">
                <div className="w-full max-w-lg space-y-5">
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                        <ShieldAlert size={20} className="text-amber-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                            <h1 className="text-base font-black text-amber-900">Two-factor authentication is required</h1>
                            <p className="text-[13px] text-amber-800 mt-1 leading-relaxed">
                                Your administrator has made a second factor mandatory for this workspace.
                                Set one up to continue.
                            </p>
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm">
                        <MFAPanel />
                    </div>

                    <button
                        onClick={() => void signOut()}
                        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
                    >
                        <LogOut size={15} /> Sign out instead
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            {children}
            {warning && (
                <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pointer-events-none">
                    <div className="mx-auto max-w-md rounded-xl border border-amber-300 bg-white shadow-xl shadow-amber-500/10 p-4 pointer-events-auto">
                        <div className="flex items-start gap-3">
                            <Clock size={18} className="text-amber-600 mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-900">Still there?</p>
                                <p className="text-[13px] text-slate-600 mt-0.5">
                                    You will be signed out in {secondsLeft ?? 0} second{secondsLeft === 1 ? '' : 's'} because of inactivity.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={staySignedIn}
                                className="flex-1 h-10 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-bold transition"
                            >
                                Stay signed in
                            </button>
                            <button
                                onClick={() => void signOut()}
                                className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
                            >
                                Sign out
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
