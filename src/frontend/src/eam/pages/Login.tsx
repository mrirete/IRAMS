import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
    const queryClient = useQueryClient();

    const from = (location.state as any)?.from?.pathname || '/';

    // ── Prefetch dashboard data to eliminate post-login load delay ──
    const prefetchDashboard = async () => {
        try {
            // Dynamically import to avoid pulling Dashboard into the Login bundle
            const { fetchDashboardData, DASHBOARD_QUERY_KEY } = await import('./Dashboard');
            // Get the current user's profile for the query key
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                // Fire and forget — don't await, let it load in background
                queryClient.prefetchQuery({
                    queryKey: [DASHBOARD_QUERY_KEY, user.id, null],
                    queryFn: () => fetchDashboardData(user.id, null),
                    staleTime: 1000 * 60 * 2,
                });
            }
        } catch (e) {
            // Non-critical — dashboard will load normally if prefetch fails
            console.debug('[Login] Dashboard prefetch skipped:', e);
        }
    };

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
            // Start loading dashboard data while React Router navigates
            prefetchDashboard();
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
            prefetchDashboard();
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
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
             style={{ background: 'linear-gradient(145deg, #0a0f1a 0%, #111827 40%, #0f172a 100%)' }}>

            {/* ── Background Effects ── */}
            <div className="absolute inset-0 opacity-[0.03]"
                 style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
            <div className="absolute top-[-10%] left-[30%] w-[600px] h-[600px] rounded-full blur-[200px]"
                 style={{ background: 'rgba(245, 158, 11, 0.08)' }} />
            <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] rounded-full blur-[180px]"
                 style={{ background: 'rgba(59, 130, 246, 0.06)' }} />
            <div className="absolute top-[40%] right-[40%] w-[300px] h-[300px] rounded-full blur-[120px]"
                 style={{ background: 'rgba(139, 92, 246, 0.04)' }} />

            {/* ── Centered Login Card ── */}
            <div className="relative z-10 w-full max-w-[460px] mx-4 sm:mx-6">

                {/* Logo + Branding */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-3 mb-5">
                        <div className="relative">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                                 style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', boxShadow: '0 4px 20px rgba(245, 158, 11, 0.4)' }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2c0 0-4 4-4 8a4 4 0 0 0 8 0c0-4-4-8-4-8z" />
                                    <path d="M12 14v4" />
                                    <path d="M10 22h4" />
                                </svg>
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2" style={{ borderColor: '#111827' }} />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-extrabold tracking-tight" style={{ color: '#ffffff' }}>IRAMS</div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#64748b' }}>by Relantern</div>
                        </div>
                    </div>
                    <h1 className="text-[28px] sm:text-[32px] font-extrabold tracking-tight leading-tight mb-2" style={{ color: '#f1f5f9' }}>
                        Welcome back
                    </h1>
                    <p className="text-[13px] font-medium" style={{ color: '#64748b' }}>
                        Integrated Reliability &amp; Asset Management Specialist
                    </p>
                </div>

                {/* ── Glass Card ── */}
                <div className="rounded-2xl p-6 sm:p-8"
                     style={{
                         background: 'rgba(255, 255, 255, 0.04)',
                         border: '1px solid rgba(255, 255, 255, 0.08)',
                         backdropFilter: 'blur(24px)',
                         boxShadow: '0 16px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05) inset',
                     }}>

                    {/* Error alert */}
                    {error && (
                        <div className="mb-5 p-3.5 rounded-xl flex items-start gap-3"
                             style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <AlertCircle className="flex-shrink-0 mt-0.5" size={17} style={{ color: '#f87171' }} />
                            <p className="text-[13px] font-medium" style={{ color: '#fca5a5' }}>{error}</p>
                        </div>
                    )}

                    {/* Login form */}
                    <form onSubmit={handleLogin} className="space-y-4">
                        {/* Username */}
                        <div>
                            <label htmlFor="login-username" className="block text-[13px] font-semibold mb-2" style={{ color: '#cbd5e1' }}>
                                Username
                            </label>
                            <div className="relative rounded-xl transition-all duration-200"
                                 style={{
                                     background: 'rgba(255, 255, 255, 0.05)',
                                     border: focusedField === 'username' ? '1.5px solid #f59e0b' : '1.5px solid rgba(255, 255, 255, 0.1)',
                                     boxShadow: focusedField === 'username' ? '0 0 0 3px rgba(245, 158, 11, 0.12)' : 'none',
                                 }}>
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                      size={17}
                                      style={{ color: focusedField === 'username' ? '#f59e0b' : '#475569' }} />
                                <input
                                    id="login-username"
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    onFocus={() => setFocusedField('username')}
                                    onBlur={() => setFocusedField(null)}
                                    className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-4 outline-none text-[15px] font-medium placeholder:text-slate-600"
                                    style={{ color: '#f1f5f9' }}
                                    placeholder="Enter your username"
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label htmlFor="login-password" className="text-[13px] font-semibold" style={{ color: '#cbd5e1' }}>
                                    Password
                                </label>
                                <button type="button" className="text-[12px] font-bold transition-colors hover:underline"
                                        style={{ color: '#f59e0b' }} onClick={() => {}}>
                                    Forgot password?
                                </button>
                            </div>
                            <div className="relative rounded-xl transition-all duration-200"
                                 style={{
                                     background: 'rgba(255, 255, 255, 0.05)',
                                     border: focusedField === 'password' ? '1.5px solid #f59e0b' : '1.5px solid rgba(255, 255, 255, 0.1)',
                                     boxShadow: focusedField === 'password' ? '0 0 0 3px rgba(245, 158, 11, 0.12)' : 'none',
                                 }}>
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                      size={17}
                                      style={{ color: focusedField === 'password' ? '#f59e0b' : '#475569' }} />
                                <input
                                    id="login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onFocus={() => setFocusedField('password')}
                                    onBlur={() => setFocusedField(null)}
                                    className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-12 outline-none text-[15px] font-medium placeholder:text-slate-600"
                                    style={{ color: '#f1f5f9' }}
                                    placeholder="Enter your password"
                                    required
                                    autoComplete="current-password"
                                />
                                <button type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                                        style={{ color: '#475569' }}
                                        tabIndex={-1}>
                                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                </button>
                            </div>
                        </div>

                        {/* Sign in button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white flex items-center justify-center gap-2.5 transition-all duration-200 group mt-2"
                            style={{
                                background: loading ? '#92600a' : 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                                boxShadow: loading ? 'none' : '0 4px 20px rgba(245, 158, 11, 0.3), 0 0 0 1px rgba(255,255,255,0.1) inset',
                                cursor: loading ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={19} />
                                    Signing in...
                                </>
                            ) : (
                                <>
                                    Sign In
                                    <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="flex items-center gap-4 my-5">
                        <div className="flex-1 h-px" style={{ background: 'rgba(255, 255, 255, 0.08)' }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#475569' }}>or</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(255, 255, 255, 0.08)' }} />
                    </div>

                    {/* Quick Switch */}
                    <button
                        onClick={() => setShowQuickSwitch(!showQuickSwitch)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200"
                        style={{
                            background: showQuickSwitch ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                            border: showQuickSwitch ? '1.5px dashed rgba(245, 158, 11, 0.4)' : '1.5px dashed rgba(255, 255, 255, 0.1)',
                        }}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                                 style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                                <Users size={15} style={{ color: '#f59e0b' }} />
                            </div>
                            <div className="text-left">
                                <div className="text-[12px] font-bold" style={{ color: '#e2e8f0' }}>Quick Switch</div>
                                <div className="text-[10px] font-medium" style={{ color: '#475569' }}>Development mode</div>
                            </div>
                        </div>
                        {showQuickSwitch
                            ? <ChevronUp size={17} style={{ color: '#64748b' }} />
                            : <ChevronDown size={17} style={{ color: '#64748b' }} />
                        }
                    </button>

                    {/* Quick Switch Panel */}
                    {showQuickSwitch && (
                        <div className="mt-3 p-4 rounded-xl"
                             style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                            <p className="text-[11px] font-medium mb-3" style={{ color: '#64748b' }}>Click to sign in as a test user</p>

                            {loadingUsers ? (
                                <div className="flex items-center justify-center py-5">
                                    <Loader2 size={17} className="animate-spin mr-2" style={{ color: '#64748b' }} />
                                    <span className="text-[12px] font-medium" style={{ color: '#64748b' }}>Loading...</span>
                                </div>
                            ) : testUsers.length === 0 ? (
                                <div className="text-center py-5 text-[12px] font-medium" style={{ color: '#64748b' }}>
                                    No users found
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                                    {testUsers.map(user => (
                                        <button
                                            key={user.username}
                                            onClick={() => handleQuickSwitch(user.username)}
                                            disabled={!!switchingUser}
                                            className="p-2.5 rounded-xl text-left transition-all duration-150"
                                            style={{
                                                background: switchingUser === user.username ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                                                border: switchingUser === user.username ? '1.5px solid rgba(245, 158, 11, 0.3)' : '1.5px solid rgba(255, 255, 255, 0.06)',
                                                opacity: switchingUser && switchingUser !== user.username ? 0.4 : 1,
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                                     style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.2))', color: '#fbbf24' }}>
                                                    {user.name?.substring(0, 2).toUpperCase() || user.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div className="overflow-hidden flex-1 min-w-0">
                                                    <div className="text-[11px] font-bold truncate" style={{ color: '#e2e8f0' }}>{user.name || user.username}</div>
                                                    <div className="text-[9px] truncate font-medium" style={{ color: '#475569' }}>@{user.username}</div>
                                                </div>
                                                {switchingUser === user.username && (
                                                    <Loader2 size={13} className="animate-spin flex-shrink-0" style={{ color: '#f59e0b' }} />
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <p className="text-[9px] mt-3 text-center font-medium" style={{ color: '#92400e' }}>⚠ Testing only — remove in production</p>
                        </div>
                    )}
                </div>

                {/* Footer under card */}
                <div className="mt-6 text-center">
                    <p className="text-[12px] font-medium" style={{ color: '#475569' }}>
                        Don't have an account?{' '}
                        <span className="font-bold cursor-pointer transition-colors" style={{ color: '#f59e0b' }}>
                            Contact IT Support
                        </span>
                    </p>
                </div>

                {/* Feature pills */}
                <div className="flex flex-wrap justify-center gap-2 mt-6">
                    {[
                        { icon: Shield, label: 'ISO 55000' },
                        { icon: Cpu, label: 'AI Reliability' },
                        { icon: BarChart3, label: '16 Modules' },
                        { icon: Wrench, label: 'FMEA/RCM' },
                    ].map(pill => (
                        <div key={pill.label}
                             className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                             style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <pill.icon size={12} style={{ color: '#f59e0b' }} />
                            <span className="text-[10px] font-bold" style={{ color: '#94a3b8' }}>{pill.label}</span>
                        </div>
                    ))}
                </div>

                {/* Trust line */}
                <div className="flex items-center justify-center gap-3 mt-5">
                    <div className="flex -space-x-2">
                        {[
                            { bg: 'linear-gradient(135deg, #f59e0b, #ea580c)', initials: 'SA' },
                            { bg: 'linear-gradient(135deg, #3b82f6, #2563eb)', initials: 'JD' },
                            { bg: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', initials: 'MR' },
                        ].map((a, i) => (
                            <div key={a.initials} className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                                 style={{ background: a.bg, border: '2px solid #111827', zIndex: 3 - i }}>
                                {a.initials}
                            </div>
                        ))}
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: '#475569' }}>
                        Trusted by reliability teams worldwide
                    </span>
                </div>
            </div>
        </div>
    );
};
