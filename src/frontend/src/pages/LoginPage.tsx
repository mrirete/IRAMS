import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    engineer: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
    planner: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    technician: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    supervisor: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    manager: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    viewer: 'bg-brand-500/15 text-slate-500 border-brand-500/30',
    safety_officer: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export const LoginPage: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { login, error } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = (location.state as any)?.from?.pathname || '/';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!username || !password) return;

        setIsSubmitting(true);
        const success = await login(username, password);
        setIsSubmitting(false);

        if (success) {
            navigate(from, { replace: true });
        }
    };

    return (
        <div className="min-h-screen bg-brand-950 flex items-center justify-center p-6">
            {/* Background grid pattern */}
            <div className="fixed inset-0 z-0 opacity-5"
                style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(148 163 184) 1px, transparent 0)', backgroundSize: '40px 40px' }}
            />

            <div className="relative z-10 w-full max-w-md">
                {/* Logo / Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-accent-cyan/20 to-blue-500/20 border border-accent-cyan/30 rounded-2xl mb-4">
                        <Shield size={32} className="text-accent-cyan" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">ERS</h1>
                    <p className="text-slate-500 text-sm mt-1">Enterprise Reliability System</p>
                </div>

                {/* Login Card */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-black/40 p-8">
                    <h2 className="text-lg font-semibold text-slate-800 mb-1">Sign in</h2>
                    <p className="text-sm text-slate-400 mb-6">Enter your credentials to access the platform</p>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Username */}
                        <div>
                            <label htmlFor="username" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Username
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                placeholder="e.g. admin"
                                autoComplete="username"
                                autoFocus
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-sm
                                           placeholder-brand-600 focus:outline-none focus:border-relantern-500 focus:ring-1 focus:ring-accent-cyan/30
                                           transition-colors"
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label htmlFor="password" className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    className="w-full px-4 py-3 pr-12 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-sm
                                               placeholder-brand-600 focus:outline-none focus:border-relantern-500 focus:ring-1 focus:ring-accent-cyan/30
                                               transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-300 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm animate-in slide-in-from-top-2 duration-200">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting || !username || !password}
                            className="w-full py-3 bg-gradient-to-r from-accent-cyan to-blue-500 text-brand-950 font-semibold rounded-lg
                                       hover:from-accent-cyan/90 hover:to-blue-500/90 transition-all
                                       disabled:opacity-50 disabled:cursor-not-allowed
                                       flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    Signing in…
                                </>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>
                </div>

                {/* Dev Hint */}
                <div className="mt-6 p-4 bg-white border border-slate-200/50 rounded-xl">
                    <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-2">Development Accounts</p>
                    <div className="space-y-1.5">
                        {[
                            { user: 'admin', role: 'admin', label: 'Full System Access' },
                            { user: 'tech1', role: 'technician', label: 'Field Maintenance' },
                            { user: 'planner1', role: 'planner', label: 'Work Planning' },
                        ].map(acct => (
                            <button
                                key={acct.user}
                                onClick={() => { setUsername(acct.user); setPassword('password'); }}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200/50 rounded-lg
                                           hover:bg-slate-50 hover:border-slate-300 transition-colors text-left group"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-brand-200 font-mono group-hover:text-accent-cyan transition-colors">{acct.user}</span>
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[acct.role] || 'bg-slate-100 text-brand-300'}`}>
                                        {acct.role}
                                    </span>
                                </div>
                                <span className="text-[10px] text-brand-600">{acct.label}</span>
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-brand-600 mt-2 text-center">Password: <code className="text-slate-500">password</code></p>
                </div>
            </div>
        </div>
    );
};
