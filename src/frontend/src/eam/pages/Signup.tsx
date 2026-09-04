/**
 * Signup — self-serve workspace creation (Phase 6b).
 *
 * One form → the signup-tenant edge function → a fully provisioned, isolated
 * Starter tenant (provision_tenant clones the product seed set; the tier is
 * pinned server-side no matter what a client sends) → sign in → straight into
 * the app. Sales-led onboarding (create-tenant.mjs) still exists for
 * everything above Starter.
 *
 * Visual idiom mirrors Login.tsx: white card, amber accent, slate text.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Building2, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Cloudflare Turnstile (launch review B6). Renders only when the site key is
 * configured; the signup-tenant function enforces the token only when its
 * secret is configured. Set both to turn the challenge on:
 *   VITE_TURNSTILE_SITE_KEY (Vercel env) + TURNSTILE_SECRET_KEY (Supabase secret)
 */
const TURNSTILE_SITE_KEY: string = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string) || '';
declare global { interface Window { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void } } }

const ACCENT = '#f59e0b';

export const Signup: React.FC = () => {
    const [companyName, setCompanyName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [captchaToken, setCaptchaToken] = useState('');
    const [honeypot, setHoneypot] = useState('');
    /** Set when the workspace exists but the admin must confirm their email first (0314). */
    const [awaitingVerify, setAwaitingVerify] = useState<{ email: string; code: string } | null>(null);
    const [resent, setResent] = useState('');
    const captchaRef = useRef<HTMLDivElement>(null);

    // Load the Turnstile script once and render the widget into captchaRef.
    useEffect(() => {
        if (!TURNSTILE_SITE_KEY || !captchaRef.current) return;
        let widgetId: string | undefined;
        const render = () => {
            if (!window.turnstile || !captchaRef.current || widgetId) return;
            widgetId = window.turnstile.render(captchaRef.current, {
                sitekey: TURNSTILE_SITE_KEY,
                callback: (token: string) => setCaptchaToken(token),
                'expired-callback': () => setCaptchaToken(''),
                'error-callback': () => setCaptchaToken(''),
            });
        };
        if (window.turnstile) { render(); return; }
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true; s.defer = true;
        s.onload = render;
        document.head.appendChild(s);
        return () => { try { if (widgetId) window.turnstile?.reset(widgetId); } catch { /* ignore */ } };
    }, []);

    const fieldStyle = (name: string) => ({
        background: '#f8fafc',
        border: focusedField === name ? `1.5px solid ${ACCENT}` : '1.5px solid #e2e8f0',
        boxShadow: focusedField === name ? '0 0 0 3px rgba(245, 158, 11, 0.1)' : 'none',
    });
    const iconColor = (name: string) => ({ color: focusedField === name ? ACCENT : '#94a3b8' });

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password.length < 10) { setError('Password must be at least 10 characters.'); return; }
        setBusy(true);
        try {
            // The shared client resolves URL + anon key (never duplicate a
            // createClient — see eam/lib/supabase). A non-2xx from the function
            // surfaces as FunctionsHttpError with the Response in .context.
            if (TURNSTILE_SITE_KEY && !captchaToken) { setError('Please complete the verification challenge.'); return; }
            const { data, error: fnErr } = await supabase.functions.invoke('signup-tenant', {
                body: { company_name: companyName, admin_email: email, password, captcha_token: captchaToken || undefined, website: honeypot },
            });
            if (fnErr || !data?.ok) {
                let msg = 'Something went wrong — please try again.';
                try { msg = (await (fnErr as any)?.context?.json())?.error ?? data?.error ?? msg; } catch { /* keep default */ }
                setError(msg);
                return;
            }
            // Email verification (0314): the function un-confirmed the account and
            // emailed a link. Sign-in would fail with "Email not confirmed" — show
            // the inbox panel instead.
            if (data?.verify_email) {
                setAwaitingVerify({ email: email.trim().toLowerCase(), code: String(data.company_code ?? '') });
                return;
            }
            // Workspace exists; sign its first admin in and enter the app. A full
            // navigation (not SPA route) so every context boots fresh against the
            // new session — tier, settings, licence all resolve from the new tenant.
            const { error: signInErr } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
            if (signInErr) {
                setError('Workspace created — but sign-in failed. Use the login page with the credentials you just chose.');
                return;
            }
            window.location.assign('/');
        } catch {
            setError('Network problem — please try again.');
        } finally {
            setBusy(false);
        }
    };

    const resendLink = async () => {
        if (!awaitingVerify) return;
        setResent('');
        const { data, error: fnErr } = await supabase.functions.invoke('signup-tenant', {
            body: { action: 'resend_verification', admin_email: awaitingVerify.email },
        });
        setResent(fnErr || !data?.ok ? 'Could not resend right now — try again in a minute.' : 'Sent. Check your inbox (and spam folder).');
    };

    if (awaitingVerify) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#f1f5f9' }}>
                <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] mb-6" style={{ color: '#94a3b8' }}>IREAMS by Relantern</div>
                    <h1 className="text-xl font-bold text-slate-900">Check your inbox</h1>
                    <p className="mt-3 text-slate-600">
                        Your workspace <span className="font-mono text-slate-800">{awaitingVerify.code}</span> is ready. We sent a confirmation link to <span className="font-semibold text-slate-800">{awaitingVerify.email}</span>. Open it to sign in as the administrator.
                    </p>
                    <p className="mt-2 text-sm text-slate-500">The link works once and expires in 24 hours.</p>
                    <button type="button" onClick={resendLink} className="mt-6 text-blue-600 font-semibold hover:underline">Resend the link</button>
                    {resent && <p className="mt-2 text-sm text-slate-600">{resent}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col" style={{ background: '#f1f5f9' }}>
            <header className="flex items-center justify-between px-6 sm:px-10 py-5 relative z-10">
                <div>
                    <div className="text-[17px] font-extrabold tracking-tight" style={{ color: '#1e293b' }}>IREAMS</div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>by Relantern</div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[13px] font-medium hidden sm:block" style={{ color: '#64748b' }}>Already have a workspace?</span>
                    <a href="/login" className="text-[13px] font-bold px-4 py-2 rounded-lg transition-colors"
                       style={{ color: ACCENT, border: '1.5px solid #fde68a', background: '#fffbeb' }}>
                        Sign in
                    </a>
                </div>
            </header>

            <div className="flex-1 flex items-center justify-center relative z-10 px-4 py-8">
                <div className="w-full max-w-[440px]">
                    <div className="mb-7">
                        <h1 className="text-[30px] sm:text-[34px] font-extrabold tracking-tight leading-tight" style={{ color: '#1e293b' }}>
                            Create your workspace
                        </h1>
                        <p className="text-[15px] font-medium mt-2" style={{ color: '#64748b' }}>
                            A private, isolated IREAMS for your team — ready in seconds on the Starter plan.
                        </p>
                    </div>

                    <div className="rounded-2xl p-7 sm:p-8"
                         style={{ background: '#ffffff', border: '1px solid #e2e8f0',
                                  boxShadow: '0 4px 24px rgba(148, 163, 184, 0.1), 0 1px 4px rgba(148, 163, 184, 0.06)' }}>
                        {error && (
                            <div className="mb-5 px-4 py-3 rounded-xl text-[13px] font-semibold"
                                 style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                                {error}
                            </div>
                        )}

                        <form onSubmit={submit} className="space-y-5">
                            <div>
                                <label htmlFor="su-company" className="block text-[13px] font-semibold mb-2" style={{ color: '#334155' }}>
                                    Company name
                                </label>
                                <div className="relative rounded-xl transition-all duration-200" style={fieldStyle('company')}>
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2" size={17} style={iconColor('company')} />
                                    <input id="su-company" type="text" value={companyName}
                                           onChange={(e) => setCompanyName(e.target.value)}
                                           onFocus={() => setFocusedField('company')} onBlur={() => setFocusedField(null)}
                                           className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-4 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                           style={{ color: '#1e293b' }}
                                           placeholder="e.g. Acme Industrial Services"
                                           required minLength={2} maxLength={80} />
                                </div>
                            </div>

                            <div>
                                <label htmlFor="su-email" className="block text-[13px] font-semibold mb-2" style={{ color: '#334155' }}>
                                    Work email
                                </label>
                                <div className="relative rounded-xl transition-all duration-200" style={fieldStyle('email')}>
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2" size={17} style={iconColor('email')} />
                                    <input id="su-email" type="email" value={email}
                                           onChange={(e) => setEmail(e.target.value)}
                                           onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField(null)}
                                           className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-4 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                           style={{ color: '#1e293b' }}
                                           placeholder="you@yourcompany.com"
                                           required autoComplete="email" />
                                </div>
                                <p className="text-[11px] font-medium mt-1.5" style={{ color: '#94a3b8' }}>
                                    You become the workspace administrator.
                                </p>
                            </div>

                            <div>
                                <label htmlFor="su-password" className="block text-[13px] font-semibold mb-2" style={{ color: '#334155' }}>
                                    Password
                                </label>
                                <div className="relative rounded-xl transition-all duration-200" style={fieldStyle('password')}>
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2" size={17} style={iconColor('password')} />
                                    <input id="su-password" type={showPassword ? 'text' : 'password'} value={password}
                                           onChange={(e) => setPassword(e.target.value)}
                                           onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField(null)}
                                           className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-12 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                           style={{ color: '#1e293b' }}
                                           placeholder="At least 10 characters"
                                           required minLength={10} autoComplete="new-password" />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-lg"
                                            style={{ color: '#94a3b8' }} tabIndex={-1}>
                                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                    </button>
                                </div>
                            </div>

                            {/* Honeypot — hidden from people, filled by bots; the function rejects a non-empty value. */}
                            <input type="text" name="website" value={honeypot} onChange={e => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
                            {TURNSTILE_SITE_KEY && <div ref={captchaRef} className="flex justify-center" />}
                            <button type="submit" disabled={busy || (!!TURNSTILE_SITE_KEY && !captchaToken)}
                                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[15px] font-bold text-white transition-all duration-200 disabled:opacity-60"
                                    style={{ background: ACCENT, boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)' }}>
                                {busy ? (<><Loader2 size={17} className="animate-spin" /> Creating your workspace…</>)
                                      : (<>Create workspace <ArrowRight size={17} /></>)}
                            </button>

                            <p className="text-[11px] font-medium text-center pt-1" style={{ color: '#94a3b8' }}>
                                Starter plan — work management, assets, inventory, people and finance.
                                Upgrade any time by talking to us.
                            </p>

                            {/* GDPR Art. 13 — informed at the moment of collection */}
                            <p className="text-[11px] font-medium text-center" style={{ color: '#94a3b8' }}>
                                By creating a workspace you agree to how we handle data, described in the{' '}
                                <a href="/privacy" className="underline" style={{ color: '#64748b' }}>Privacy Notice</a>.
                            </p>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};
