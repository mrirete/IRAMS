/**
 * VerifyEmail — the landing page for the link signup-tenant emails to a new
 * self-serve admin (0314). No session exists here; the token is the gate.
 * One RPC, three outcomes: verified (go sign in), stale link (resend from the
 * sign-in page), or missing token.
 */
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type State = { kind: 'checking' } | { kind: 'ok'; email: string } | { kind: 'stale' } | { kind: 'missing' };

export const VerifyEmail: React.FC = () => {
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const [state, setState] = useState<State>({ kind: token ? 'checking' : 'missing' });

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase.rpc('complete_email_verification', { p_token: token });
            if (cancelled) return;
            if (error || !data) setState({ kind: 'stale' });
            else setState({ kind: 'ok', email: String(data) });
        })();
        return () => { cancelled = true; };
    }, [token]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-6">IREAMS by Relantern</div>
                {state.kind === 'checking' && (
                    <>
                        <Loader2 className="w-10 h-10 mx-auto text-blue-600 animate-spin" />
                        <p className="mt-4 text-slate-600">Verifying your email…</p>
                    </>
                )}
                {state.kind === 'ok' && (
                    <>
                        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
                        <h1 className="mt-4 text-xl font-bold text-slate-900">Email verified</h1>
                        <p className="mt-2 text-slate-600">{state.email} is confirmed. Sign in to open your workspace.</p>
                        <Link to={`/login?email=${encodeURIComponent(state.email)}`}
                            className="mt-6 inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg">
                            Sign in
                        </Link>
                    </>
                )}
                {state.kind === 'stale' && (
                    <>
                        <AlertTriangle className="w-12 h-12 mx-auto text-amber-500" />
                        <h1 className="mt-4 text-xl font-bold text-slate-900">This link has expired</h1>
                        <p className="mt-2 text-slate-600">Verification links last 24 hours and work once. Sign in with your email and password and we will send you a fresh one.</p>
                        <Link to="/login" className="mt-6 inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg">Go to sign in</Link>
                    </>
                )}
                {state.kind === 'missing' && (
                    <>
                        <AlertTriangle className="w-12 h-12 mx-auto text-amber-500" />
                        <h1 className="mt-4 text-xl font-bold text-slate-900">No verification token</h1>
                        <p className="mt-2 text-slate-600">Open the link from your verification email, or sign in to request a new one.</p>
                        <Link to="/login" className="mt-6 inline-block text-blue-600 font-semibold">Go to sign in</Link>
                    </>
                )}
            </div>
        </div>
    );
};
