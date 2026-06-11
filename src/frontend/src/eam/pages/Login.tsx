import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    Lock, Mail, AlertCircle, Loader2, Users, ChevronDown, ChevronUp,
    Shield, Cpu, BarChart3, Wrench, ArrowRight, Eye, EyeOff
} from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';

// Test password for quick switch (development only)
const TEST_PASSWORD = 'Password123!';

// ── Feature highlights for the hero panel ──
const FEATURES = [
    { icon: Shield, label: 'ISO 55000 Compliant', desc: 'Enterprise-grade asset management' },
    { icon: Cpu, label: 'AI-Powered Reliability', desc: 'Predictive maintenance & RUL' },
    { icon: BarChart3, label: 'Real-Time Analytics', desc: 'Pareto, FMEA, RCM, Weibull' },
    { icon: Wrench, label: '16 EAM Modules', desc: 'Single source of truth' },
];

export const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [switchingUser, setSwitchingUser] = useState<string | null>(null);
    const [showQuickSwitch, setShowQuickSwitch] = useState(false);
    const [testUsers, setTestUsers] = useState<{ username: string; name: string; role: string }[]>([]);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const navigate = useNavigate();
    const location = useLocation();

    const from = (location.state as any)?.from?.pathname || '/';

    // Load available users for quick switch
    useEffect(() => {
        const loadUsers = async () => {
            setLoadingUsers(true);
            try {
                const db = DatabaseService.getInstance();
                const users = await db.getUsers();
                const contacts = await db.getContacts();

                if (users && users.length > 0) {
                    const userList = users.slice(0, 12).map(u => {
                        const contact = contacts.find(c => c.id === (u as any).contact_id);
                        return {
                            username: u.username,
                            name: contact?.name || u.username,
                            role: contact?.defaultType || contact?.types?.[0] || 'User'
                        };
                    });
                    setTestUsers(userList);
                } else {
                    setTestUsers([]);
                }
            } catch (e) {
                console.error("Could not load test users from DB:", e);
                setTestUsers([]);
            } finally {
                setLoadingUsers(false);
            }
        };
        loadUsers();
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await loginWithUsername(username, password);
            navigate(from, { replace: true });
        } catch (err: any) {
            console.error("Login failed", err);
            setError(err.message || 'Failed to log in.');
        } finally {
            setLoading(false);
        }
    };

    const loginWithUsername = async (user: string, pass: string) => {
        const normalizedUser = user.toLowerCase();
        let virtualEmail = '';
        if (normalizedUser === 'mrirete') {
            virtualEmail = 'admin001@cainergy.com';
        } else {
            virtualEmail = `${normalizedUser}@cainergy.com`;
        }

        const { error } = await supabase.auth.signInWithPassword({
            email: virtualEmail,
            password: pass,
        });

        if (error) throw error;
    };

    const handleQuickSwitch = async (targetUsername: string) => {
        setSwitchingUser(targetUsername);
        setError('');

        try {
            await supabase.auth.signOut();
            await loginWithUsername(targetUsername, TEST_PASSWORD);
            navigate(from, { replace: true });
        } catch (err: any) {
            console.error("Quick switch failed", err);
            const isInvalidCreds = err.message?.toLowerCase().includes('invalid login credentials');
            if (isInvalidCreds) {
                setError(`No auth account for "${targetUsername}". This user may need to be provisioned in Supabase Auth.`);
            } else {
                setError(`Failed to switch to ${targetUsername}: ${err.message}`);
            }
        } finally {
            setSwitchingUser(null);
        }
    };

    return (
        <div className="min-h-screen flex bg-white">
            {/* ═══════════════════════════════════════════════════════ */}
            {/* LEFT PANEL — Login Form                                */}
            {/* ═══════════════════════════════════════════════════════ */}
            <div className="w-full lg:w-[480px] xl:w-[520px] flex-shrink-0 flex flex-col min-h-screen relative z-10">
                {/* Top bar with logo */}
                <div className="px-8 pt-8 pb-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z" />
                                <path d="M12 14v4" />
                                <path d="M10 22h4" />
                            </svg>
                        </div>
                        <div>
                            <span className="text-lg font-black text-slate-900 tracking-tight">IRAMS</span>
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest ml-2">by Relantern</span>
                        </div>
                    </div>
                </div>

                {/* Form — centered vertically */}
                <div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-14 py-8">
                    <div className="max-w-sm w-full mx-auto lg:mx-0">
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">
                            Welcome back
                        </h1>
                        <p className="text-slate-500 text-[15px] font-medium mb-8">
                            Enter your credentials to access IRAMS.
                        </p>

                        {/* Error message */}
                        {error && (
                            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                <AlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={18} />
                                <p className="text-sm text-red-700 font-medium">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleLogin} className="space-y-5">
                            {/* Username field */}
                            <div className="space-y-2">
                                <label htmlFor="username" className="text-sm font-semibold text-slate-700">
                                    Username
                                </label>
                                <div className={`relative rounded-xl border-2 transition-all duration-200 ${
                                    focusedField === 'username'
                                        ? 'border-amber-500 ring-4 ring-amber-500/10'
                                        : 'border-slate-200 hover:border-slate-300'
                                }`}>
                                    <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
                                        focusedField === 'username' ? 'text-amber-500' : 'text-slate-400'
                                    }`} size={18} aria-hidden="true" />
                                    <input
                                        id="username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent text-slate-900 rounded-xl py-3 pl-11 pr-4 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                        placeholder="Enter your username"
                                        required
                                        autoComplete="username"
                                    />
                                </div>
                            </div>

                            {/* Password field */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="password" className="text-sm font-semibold text-slate-700">
                                        Password
                                    </label>
                                    <button
                                        type="button"
                                        className="text-[13px] font-semibold text-amber-600 hover:text-amber-700 transition-colors"
                                        onClick={() => {}}
                                    >
                                        Forgot password?
                                    </button>
                                </div>
                                <div className={`relative rounded-xl border-2 transition-all duration-200 ${
                                    focusedField === 'password'
                                        ? 'border-amber-500 ring-4 ring-amber-500/10'
                                        : 'border-slate-200 hover:border-slate-300'
                                }`}>
                                    <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200 ${
                                        focusedField === 'password' ? 'text-amber-500' : 'text-slate-400'
                                    }`} size={18} aria-hidden="true" />
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent text-slate-900 rounded-xl py-3 pl-11 pr-12 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                        placeholder="Enter your password"
                                        required
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {/* Sign in button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-amber-500/25 transition-all duration-200 flex items-center justify-center gap-2.5 text-[15px] group ${
                                    loading ? 'opacity-70 cursor-not-allowed' : 'hover:shadow-xl hover:shadow-amber-500/30 active:scale-[0.98]'
                                }`}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="animate-spin" size={20} />
                                        Signing in...
                                    </>
                                ) : (
                                    <>
                                        Sign In
                                        <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Divider */}
                        <div className="flex items-center gap-3 my-6">
                            <div className="flex-1 h-px bg-slate-200"></div>
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">or</span>
                            <div className="flex-1 h-px bg-slate-200"></div>
                        </div>

                        {/* Quick Switch toggle */}
                        <button
                            onClick={() => setShowQuickSwitch(!showQuickSwitch)}
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                                    <Users size={16} className="text-amber-600" />
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-semibold text-slate-700">Quick Switch</div>
                                    <div className="text-[11px] text-slate-400 font-medium">Dev / Testing mode</div>
                                </div>
                            </div>
                            {showQuickSwitch
                                ? <ChevronUp size={18} className="text-slate-400" />
                                : <ChevronDown size={18} className="text-slate-400" />
                            }
                        </button>

                        {/* Quick Switch Panel */}
                        {showQuickSwitch && (
                            <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300">
                                <p className="text-xs text-slate-500 mb-3 font-medium">Click to instantly sign in as a test user</p>

                                {loadingUsers ? (
                                    <div className="flex items-center justify-center py-6 text-slate-400">
                                        <Loader2 size={18} className="animate-spin mr-2" />
                                        <span className="text-sm font-medium">Loading users...</span>
                                    </div>
                                ) : testUsers.length === 0 ? (
                                    <div className="text-center py-6 text-slate-400 text-sm font-medium">
                                        No users found in database
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                                        {testUsers.map(user => (
                                            <button
                                                key={user.username}
                                                onClick={() => handleQuickSwitch(user.username)}
                                                disabled={!!switchingUser}
                                                className={`p-2.5 rounded-lg border text-left transition-all ${
                                                    switchingUser === user.username
                                                        ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/20'
                                                        : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-sm'
                                                } ${switchingUser && switchingUser !== user.username ? 'opacity-40' : ''}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-600 flex-shrink-0">
                                                        {user.name?.substring(0, 2).toUpperCase() || user.username.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div className="overflow-hidden flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-slate-800 truncate">{user.name || user.username}</div>
                                                        <div className="text-[11px] text-slate-400 truncate font-medium">@{user.username}</div>
                                                    </div>
                                                    {switchingUser === user.username && (
                                                        <Loader2 size={14} className="animate-spin text-amber-500 flex-shrink-0" />
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[10px] text-amber-600/70 mt-3 text-center font-medium">⚠ Testing only — remove in production</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 pb-6">
                    <p className="text-[13px] text-slate-400 font-medium">
                        Don't have an account? <span className="text-slate-600 font-semibold cursor-pointer hover:text-amber-600 transition-colors">Contact IT Support</span>
                    </p>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* RIGHT PANEL — Hero / Product Showcase                   */}
            {/* ═══════════════════════════════════════════════════════ */}
            <div className="hidden lg:flex flex-1 relative overflow-hidden">
                {/* Background gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />

                {/* Animated grid pattern */}
                <div className="absolute inset-0 opacity-[0.03]"
                     style={{
                         backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
                         backgroundSize: '60px 60px'
                     }}
                />

                {/* Glowing orbs */}
                <div className="absolute top-[15%] right-[20%] w-80 h-80 bg-amber-500/15 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
                <div className="absolute bottom-[20%] left-[10%] w-64 h-64 bg-orange-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '6s' }} />
                <div className="absolute top-[60%] right-[40%] w-48 h-48 bg-cyan-500/8 rounded-full blur-[80px] animate-pulse" style={{ animationDuration: '5s' }} />

                {/* Content */}
                <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 py-16 w-full">
                    {/* Hero text */}
                    <div className="mb-12">
                        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Enterprise Platform</span>
                        </div>

                        <h2 className="text-4xl xl:text-5xl font-black text-white leading-[1.1] tracking-tight mb-5">
                            The smarter way<br />
                            to manage your<br />
                            <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                                industrial assets
                            </span>
                        </h2>
                        <p className="text-slate-400 text-lg font-medium leading-relaxed max-w-lg">
                            AI-powered maintenance intelligence, reliability engineering, and asset lifecycle management — all in one platform.
                        </p>
                    </div>

                    {/* Feature cards */}
                    <div className="grid grid-cols-2 gap-3 mb-12 max-w-lg">
                        {FEATURES.map((feat, i) => (
                            <div
                                key={feat.label}
                                className="group p-4 rounded-xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-300"
                                style={{ animationDelay: `${i * 100}ms` }}
                            >
                                <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center mb-3 group-hover:bg-amber-500/25 transition-colors">
                                    <feat.icon size={18} className="text-amber-400" />
                                </div>
                                <div className="text-[13px] font-bold text-white mb-0.5">{feat.label}</div>
                                <div className="text-[11px] text-slate-500 font-medium">{feat.desc}</div>
                            </div>
                        ))}
                    </div>

                    {/* Trust bar */}
                    <div className="flex items-center gap-6">
                        <div className="flex -space-x-2">
                            {['SA', 'JD', 'MR', 'AK'].map((initials, i) => (
                                <div
                                    key={initials}
                                    className="w-8 h-8 rounded-full border-2 border-slate-800 flex items-center justify-center text-[10px] font-bold"
                                    style={{
                                        background: [
                                            'linear-gradient(135deg, #f59e0b, #ea580c)',
                                            'linear-gradient(135deg, #06b6d4, #3b82f6)',
                                            'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                            'linear-gradient(135deg, #10b981, #059669)',
                                        ][i],
                                        color: 'white',
                                        zIndex: 4 - i
                                    }}
                                >
                                    {initials}
                                </div>
                            ))}
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">Trusted by reliability teams</div>
                            <div className="text-xs text-slate-500 font-medium">Oil & Gas • Power • Manufacturing</div>
                        </div>
                    </div>
                </div>

                {/* Floating dashboard preview card */}
                <div className="absolute bottom-8 right-8 xl:right-12 w-72 xl:w-80 opacity-80 hover:opacity-100 transition-opacity duration-500">
                    <div className="rounded-xl bg-white/[0.06] border border-white/[0.08] backdrop-blur-xl p-4 shadow-2xl">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Live Dashboard</div>
                            <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-[10px] text-emerald-400 font-semibold">Online</span>
                            </div>
                        </div>
                        {/* Mini stat cards */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {[
                                { label: 'Assets', value: '1,247', color: 'text-amber-400' },
                                { label: 'MTBF', value: '842d', color: 'text-cyan-400' },
                                { label: 'Uptime', value: '99.2%', color: 'text-emerald-400' },
                            ].map(s => (
                                <div key={s.label} className="bg-white/[0.04] rounded-lg p-2 text-center">
                                    <div className={`text-sm font-black ${s.color}`}>{s.value}</div>
                                    <div className="text-[9px] text-slate-500 font-semibold uppercase">{s.label}</div>
                                </div>
                            ))}
                        </div>
                        {/* Mini bar chart */}
                        <div className="flex items-end gap-1 h-12 px-1">
                            {[35, 55, 45, 70, 60, 80, 65, 75, 50, 85, 70, 90].map((h, i) => (
                                <div
                                    key={i}
                                    className="flex-1 rounded-sm transition-all duration-500"
                                    style={{
                                        height: `${h}%`,
                                        background: i >= 10
                                            ? 'linear-gradient(to top, #f59e0b, #fbbf24)'
                                            : 'rgba(255,255,255,0.08)',
                                        animationDelay: `${i * 50}ms`
                                    }}
                                />
                            ))}
                        </div>
                        <div className="flex justify-between mt-2">
                            <span className="text-[9px] text-slate-600 font-medium">Jan</span>
                            <span className="text-[9px] text-slate-600 font-medium">Jun</span>
                            <span className="text-[9px] text-slate-600 font-medium">Dec</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
