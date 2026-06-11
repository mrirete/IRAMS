import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    Lock, Mail, AlertCircle, Loader2, Users, ChevronDown, ChevronUp,
    Shield, Cpu, BarChart3, Wrench, ArrowRight, Eye, EyeOff,
    TrendingUp, Activity, Zap, CheckCircle2
} from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';

// Test password for quick switch (development only)
const TEST_PASSWORD = 'Password123!';

// ── Stats for the dashboard preview ──
const LIVE_STATS = [
    { label: 'Total Assets', value: '1,247', change: '+12', positive: true, icon: Activity },
    { label: 'Avg MTBF', value: '842d', change: '+5.2%', positive: true, icon: TrendingUp },
    { label: 'Uptime', value: '99.2%', change: '+0.3%', positive: true, icon: Zap },
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
        <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f0fdf4 100%)' }}>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* LEFT PANEL — Login Form                                */}
            {/* ═══════════════════════════════════════════════════════ */}
            <div className="w-full lg:w-[520px] xl:w-[560px] flex-shrink-0 flex flex-col min-h-screen relative z-10">

                {/* Top nav bar */}
                <div className="px-8 sm:px-10 pt-8">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {/* Logo mark */}
                            <div className="relative">
                                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg"
                                     style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z" />
                                        <path d="M12 14v4" />
                                        <path d="M10 22h4" />
                                    </svg>
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[18px] font-extrabold tracking-tight" style={{ color: '#0f172a' }}>IRAMS</span>
                                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>by Relantern</span>
                            </div>
                        </div>
                        {/* Version badge */}
                        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                             style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[11px] font-bold" style={{ color: '#b45309' }}>v3.2</span>
                        </div>
                    </div>
                </div>

                {/* Form Container — vertically centered */}
                <div className="flex-1 flex flex-col justify-center px-8 sm:px-10 lg:px-12 py-8">
                    <div className="max-w-[380px] w-full mx-auto">

                        {/* Welcome heading */}
                        <div className="mb-8">
                            <h1 className="text-[32px] font-extrabold tracking-tight leading-tight mb-1.5" style={{ color: '#0f172a' }}>
                                Welcome back
                            </h1>
                            <p className="text-[11px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: '#d97706' }}>
                                Integrated Reliability &amp; Asset Management Specialist
                            </p>
                            <p className="text-[15px] font-medium" style={{ color: '#64748b' }}>
                                Sign in to access your dashboard
                            </p>
                        </div>

                        {/* Error alert */}
                        {error && (
                            <div className="mb-5 p-4 rounded-2xl flex items-start gap-3"
                                 style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.12)' }}>
                                <AlertCircle className="flex-shrink-0 mt-0.5" size={18} style={{ color: '#ef4444' }} />
                                <p className="text-[13px] font-medium" style={{ color: '#dc2626' }}>{error}</p>
                            </div>
                        )}

                        {/* Login form */}
                        <form onSubmit={handleLogin} className="space-y-4">
                            {/* Username */}
                            <div>
                                <label htmlFor="login-username" className="block text-[13px] font-semibold mb-2" style={{ color: '#334155' }}>
                                    Username
                                </label>
                                <div className="relative rounded-xl transition-all duration-200"
                                     style={{
                                         background: '#ffffff',
                                         border: focusedField === 'username' ? '2px solid #f59e0b' : '2px solid #e2e8f0',
                                         boxShadow: focusedField === 'username' ? '0 0 0 4px rgba(245, 158, 11, 0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
                                     }}>
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                          size={18}
                                          style={{ color: focusedField === 'username' ? '#f59e0b' : '#94a3b8' }} />
                                    <input
                                        id="login-username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-4 outline-none text-[15px] font-medium"
                                        style={{ color: '#0f172a' }}
                                        placeholder="Enter your username"
                                        required
                                        autoComplete="username"
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label htmlFor="login-password" className="text-[13px] font-semibold" style={{ color: '#334155' }}>
                                        Password
                                    </label>
                                    <button type="button" className="text-[12px] font-bold transition-colors hover:underline"
                                            style={{ color: '#f59e0b' }} onClick={() => {}}>
                                        Forgot password?
                                    </button>
                                </div>
                                <div className="relative rounded-xl transition-all duration-200"
                                     style={{
                                         background: '#ffffff',
                                         border: focusedField === 'password' ? '2px solid #f59e0b' : '2px solid #e2e8f0',
                                         boxShadow: focusedField === 'password' ? '0 0 0 4px rgba(245, 158, 11, 0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
                                     }}>
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                          size={18}
                                          style={{ color: focusedField === 'password' ? '#f59e0b' : '#94a3b8' }} />
                                    <input
                                        id="login-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-12 outline-none text-[15px] font-medium"
                                        style={{ color: '#0f172a' }}
                                        placeholder="Enter your password"
                                        required
                                        autoComplete="current-password"
                                    />
                                    <button type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                                            style={{ color: '#94a3b8' }}
                                            tabIndex={-1}>
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            {/* Sign in button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white flex items-center justify-center gap-2.5 transition-all duration-200 group"
                                style={{
                                    background: loading ? '#d4a054' : 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                                    boxShadow: loading ? 'none' : '0 4px 14px rgba(245, 158, 11, 0.35), 0 1px 3px rgba(0,0,0,0.1)',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    transform: 'translateY(0)',
                                }}
                                onMouseDown={(e) => !loading && ((e.currentTarget.style.transform = 'translateY(1px)'))}
                                onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
                                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
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
                        <div className="flex items-center gap-4 my-6">
                            <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} />
                            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>or</span>
                            <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} />
                        </div>

                        {/* Quick Switch */}
                        <button
                            onClick={() => setShowQuickSwitch(!showQuickSwitch)}
                            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl transition-all duration-200"
                            style={{
                                background: showQuickSwitch ? 'rgba(245, 158, 11, 0.06)' : '#ffffff',
                                border: showQuickSwitch ? '2px dashed #f59e0b' : '2px dashed #e2e8f0',
                                boxShadow: showQuickSwitch ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
                                     style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                                    <Users size={17} style={{ color: '#d97706' }} />
                                </div>
                                <div className="text-left">
                                    <div className="text-[13px] font-bold" style={{ color: '#334155' }}>Quick Switch</div>
                                    <div className="text-[11px] font-medium" style={{ color: '#94a3b8' }}>Development mode</div>
                                </div>
                            </div>
                            {showQuickSwitch
                                ? <ChevronUp size={18} style={{ color: '#94a3b8' }} />
                                : <ChevronDown size={18} style={{ color: '#94a3b8' }} />
                            }
                        </button>

                        {/* Quick Switch Panel */}
                        {showQuickSwitch && (
                            <div className="mt-3 p-4 rounded-xl"
                                 style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <p className="text-[12px] font-medium mb-3" style={{ color: '#64748b' }}>Click to sign in as a test user</p>

                                {loadingUsers ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 size={18} className="animate-spin mr-2" style={{ color: '#94a3b8' }} />
                                        <span className="text-[13px] font-medium" style={{ color: '#94a3b8' }}>Loading...</span>
                                    </div>
                                ) : testUsers.length === 0 ? (
                                    <div className="text-center py-6 text-[13px] font-medium" style={{ color: '#94a3b8' }}>
                                        No users found
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                                        {testUsers.map(user => (
                                            <button
                                                key={user.username}
                                                onClick={() => handleQuickSwitch(user.username)}
                                                disabled={!!switchingUser}
                                                className="p-2.5 rounded-xl text-left transition-all duration-150"
                                                style={{
                                                    background: switchingUser === user.username ? 'rgba(245, 158, 11, 0.08)' : '#f8fafc',
                                                    border: switchingUser === user.username ? '1.5px solid #f59e0b' : '1.5px solid #e2e8f0',
                                                    opacity: switchingUser && switchingUser !== user.username ? 0.4 : 1,
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                                         style={{ background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)', color: '#475569' }}>
                                                        {user.name?.substring(0, 2).toUpperCase() || user.username.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div className="overflow-hidden flex-1 min-w-0">
                                                        <div className="text-[12px] font-bold truncate" style={{ color: '#1e293b' }}>{user.name || user.username}</div>
                                                        <div className="text-[10px] truncate font-medium" style={{ color: '#94a3b8' }}>@{user.username}</div>
                                                    </div>
                                                    {switchingUser === user.username && (
                                                        <Loader2 size={14} className="animate-spin flex-shrink-0" style={{ color: '#f59e0b' }} />
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[10px] mt-3 text-center font-medium" style={{ color: '#d97706' }}>⚠ Testing only — remove in production</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 sm:px-10 pb-6 text-center">
                    <p className="text-[13px] font-medium" style={{ color: '#94a3b8' }}>
                        Don't have an account?{' '}
                        <span className="font-bold cursor-pointer transition-colors" style={{ color: '#334155' }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#f59e0b')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#334155')}>
                            Contact IT Support
                        </span>
                    </p>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* RIGHT PANEL — Dashboard Preview                        */}
            {/* ═══════════════════════════════════════════════════════ */}
            <div className="hidden lg:flex flex-1 relative overflow-hidden items-center justify-center p-8 xl:p-12">

                {/* Layered background */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }} />
                <div className="absolute inset-0 opacity-[0.04]"
                     style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }} />

                {/* Glow effects */}
                <div className="absolute top-[10%] left-[20%] w-96 h-96 rounded-full blur-[150px]"
                     style={{ background: 'rgba(245, 158, 11, 0.12)' }} />
                <div className="absolute bottom-[15%] right-[15%] w-80 h-80 rounded-full blur-[120px]"
                     style={{ background: 'rgba(59, 130, 246, 0.08)' }} />

                {/* Content wrapper */}
                <div className="relative z-10 w-full max-w-xl">

                    {/* Header badge */}
                    <div className="flex items-center gap-2 mb-6">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                             style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#fbbf24' }}>Enterprise Platform</span>
                        </div>
                    </div>

                    {/* Hero heading */}
                    <h2 className="text-[42px] xl:text-[48px] font-extrabold leading-[1.08] tracking-tight mb-4" style={{ color: '#ffffff' }}>
                        The smarter way<br />
                        to manage your<br />
                        <span style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #ea580c 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            industrial assets
                        </span>
                    </h2>
                    <p className="text-[16px] font-medium leading-relaxed mb-10 max-w-md" style={{ color: '#64748b' }}>
                        AI-powered maintenance intelligence, reliability engineering, and asset lifecycle management.
                    </p>

                    {/* ── Dashboard Preview Card ── */}
                    <div className="rounded-2xl p-5 mb-6"
                         style={{
                             background: 'rgba(255, 255, 255, 0.04)',
                             border: '1px solid rgba(255, 255, 255, 0.08)',
                             backdropFilter: 'blur(20px)',
                             boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                         }}>

                        {/* Card header */}
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.15)' }}>
                                    <BarChart3 size={14} style={{ color: '#fbbf24' }} />
                                </div>
                                <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Dashboard Overview</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(16, 185, 129, 0.1)' }}>
                                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                                <span className="text-[10px] font-bold" style={{ color: '#34d399' }}>Live</span>
                            </div>
                        </div>

                        {/* Stat cards row */}
                        <div className="grid grid-cols-3 gap-3 mb-5">
                            {LIVE_STATS.map(stat => (
                                <div key={stat.label} className="p-3.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div className="flex items-center justify-between mb-2">
                                        <stat.icon size={14} style={{ color: '#64748b' }} />
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                                              style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#34d399' }}>
                                            {stat.change}
                                        </span>
                                    </div>
                                    <div className="text-[20px] font-extrabold tracking-tight" style={{ color: '#ffffff' }}>{stat.value}</div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: '#475569' }}>{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        {/* Mini chart */}
                        <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-bold" style={{ color: '#64748b' }}>Asset Health Trend</span>
                                <div className="flex gap-1">
                                    {['1W', '1M', '3M', '1Y'].map((period, i) => (
                                        <button key={period} className="px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors"
                                                style={{
                                                    background: i === 2 ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                                                    color: i === 2 ? '#fbbf24' : '#475569',
                                                }}>
                                            {period}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-end gap-[3px] h-16">
                                {[32, 45, 38, 52, 48, 62, 55, 68, 58, 72, 65, 78, 70, 82, 75, 88, 80, 92, 85, 95].map((h, i) => (
                                    <div key={i} className="flex-1 rounded-sm transition-all"
                                         style={{
                                             height: `${h}%`,
                                             background: i >= 17
                                                 ? 'linear-gradient(to top, #f59e0b, #fbbf24)'
                                                 : i >= 14
                                                     ? 'rgba(245, 158, 11, 0.3)'
                                                     : 'rgba(255, 255, 255, 0.06)',
                                             borderRadius: '2px',
                                         }} />
                                ))}
                            </div>
                            <div className="flex justify-between mt-2">
                                <span className="text-[9px] font-medium" style={{ color: '#475569' }}>Jan</span>
                                <span className="text-[9px] font-medium" style={{ color: '#475569' }}>Apr</span>
                                <span className="text-[9px] font-medium" style={{ color: '#475569' }}>Jul</span>
                                <span className="text-[9px] font-medium" style={{ color: '#475569' }}>Oct</span>
                            </div>
                        </div>
                    </div>

                    {/* Feature pills */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        {[
                            { icon: Shield, label: 'ISO 55000' },
                            { icon: Cpu, label: 'AI Reliability' },
                            { icon: BarChart3, label: 'Analytics' },
                            { icon: Wrench, label: '16 Modules' },
                            { icon: CheckCircle2, label: 'FMEA/RCM' },
                        ].map(pill => (
                            <div key={pill.label}
                                 className="flex items-center gap-2 px-3 py-2 rounded-xl"
                                 style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <pill.icon size={13} style={{ color: '#fbbf24' }} />
                                <span className="text-[11px] font-bold" style={{ color: '#cbd5e1' }}>{pill.label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Trust row */}
                    <div className="flex items-center gap-4">
                        <div className="flex -space-x-2.5">
                            {[
                                { bg: 'linear-gradient(135deg, #f59e0b, #ea580c)', initials: 'SA' },
                                { bg: 'linear-gradient(135deg, #3b82f6, #2563eb)', initials: 'JD' },
                                { bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', initials: 'MR' },
                                { bg: 'linear-gradient(135deg, #10b981, #059669)', initials: 'AK' },
                            ].map((a, i) => (
                                <div key={a.initials} className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                     style={{ background: a.bg, border: '2px solid #1e293b', zIndex: 4 - i }}>
                                    {a.initials}
                                </div>
                            ))}
                        </div>
                        <div>
                            <div className="text-[13px] font-bold" style={{ color: '#e2e8f0' }}>Trusted by reliability teams</div>
                            <div className="text-[11px] font-medium" style={{ color: '#475569' }}>Oil & Gas · Power · Manufacturing</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
