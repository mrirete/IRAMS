import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-blue-50 text-blue-600 border-blue-200',
    engineer: 'bg-cyan-50 text-cyan-600 border-cyan-200',
    planner: 'bg-sky-50 text-sky-600 border-sky-200',
    technician: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    supervisor: 'bg-relantern-50 text-relantern-700 border-relantern-200',
    manager: 'bg-orange-50 text-orange-600 border-orange-200',
    viewer: 'bg-slate-100 text-slate-500 border-slate-200',
    safety_officer: 'bg-red-50 text-red-600 border-red-200',
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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-6">
            {/* Subtle geometric pattern */}
            <div className="fixed inset-0 z-0 opacity-[0.03]"
                style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(100 116 139) 1px, transparent 0)', backgroundSize: '32px 32px' }}
            />

            <div className="relative z-10 w-full max-w-md">
                {/* Logo / Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-relantern-400 to-relantern-600 rounded-2xl mb-4 shadow-lg shadow-relantern-500/25">
                        <Shield size={32} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">IRAMS</h1>
                    <p className="text-slate-500 text-sm mt-1">Integrated Reliability & Asset Management</p>
                </div>

                {/* Login Card */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-200/60 p-8">
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
                                           placeholder-slate-400 focus:outline-none focus:border-relantern-500 focus:ring-2 focus:ring-relantern-400/20
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
                                               placeholder-slate-400 focus:outline-none focus:border-relantern-500 focus:ring-2 focus:ring-relantern-400/20
                                               transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm animate-in slide-in-from-top-2 duration-200">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting || !username || !password}
                            className="w-full py-3 bg-gradient-to-r from-relantern-500 to-relantern-600 text-white font-semibold rounded-lg
                                       hover:from-relantern-600 hover:to-relantern-700 transition-all shadow-md shadow-relantern-500/20
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
                <div className="mt-6 p-4 bg-white border border-slate-200/80 rounded-xl shadow-sm">
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
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg
                                           hover:bg-slate-100 hover:border-slate-300 transition-colors text-left group"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-600 font-mono group-hover:text-blue-600 transition-colors">{acct.user}</span>
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[acct.role] || 'bg-slate-100 text-slate-500'}`}>
                                        {acct.role}
                                    </span>
                                </div>
                                <span className="text-[10px] text-slate-400">{acct.label}</span>
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 text-center">Password: <code className="text-slate-600 bg-slate-100 px-1 py-0.5 rounded">password</code></p>
                </div>
            </div>
        </div>
    );
};
