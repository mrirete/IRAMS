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

// Quick Switch is DEVELOPMENT ONLY — stripped from production builds
const IS_DEV = import.meta.env.DEV;
const TEST_PASSWORD = IS_DEV ? 'Password123!' : '';

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
    const [loadingUsers, setLoadingUsers] = useState(IS_DEV);
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
    // Only load test users in development mode
    useEffect(() => {
        if (!IS_DEV) { setLoadingUsers(false); return; }
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
            // A bare username only resolves for legacy (username@cainergy.com)
            // accounts. Invited accounts (0190) are registered under their real
            // email — steer the user there instead of a dead-end error.
            const invalidCreds = (err.message || '').toLowerCase().includes('invalid login credentials');
            if (invalidCreds && !username.includes('@')) {
                setError('No account found for that username — try signing in with your email address instead.');
            } else {
                setError(err.message || 'Failed to log in.');
            }
        } finally {
            setLoading(false);
        }
    };

    const loginWithUsername = async (user: string, pass: string) => {
        const normalizedUser = user.trim().toLowerCase();
        let virtualEmail = '';
        if (normalizedUser.includes('@')) {
            // Invited users register under their real (company) email — use as-is.
            virtualEmail = normalizedUser;
        } else if (normalizedUser === 'mrirete') {
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
        <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#f8fafc' }}>

            {/* ── Top Navigation Bar ── */}
            <header className="relative z-20 flex items-center justify-between px-6 sm:px-10 py-4"
                    style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
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
                        <div className="text-[17px] font-extrabold tracking-tight" style={{ color: '#1e293b' }}>IRAMS</div>
                        <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#94a3b8' }}>by Relantern</div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[13px] font-medium hidden sm:block" style={{ color: '#64748b' }}>Don't have an account?</span>
                    <button className="text-[13px] font-bold px-4 py-2 rounded-lg transition-colors"
                            style={{ color: '#f59e0b', border: '1.5px solid #fde68a', background: '#fffbeb' }}>
                        Contact IT Support
                    </button>
                </div>
            </header>

            {/* ── Main Content Area ── */}
            <div className="flex-1 flex items-center justify-center relative z-10 px-4 py-8">
                <div className="w-full max-w-[440px]">

                    {/* Welcome */}
                    <div className="mb-7">
                        <h1 className="text-[30px] sm:text-[34px] font-extrabold tracking-tight leading-tight" style={{ color: '#1e293b' }}>
                            Welcome back
                        </h1>
                        <p className="text-[15px] font-medium mt-2" style={{ color: '#64748b' }}>
                            Integrated Reliability &amp; Asset Management Specialist
                        </p>
                    </div>

                    {/* ── Login Card ── */}
                    <div className="rounded-2xl p-7 sm:p-8"
                         style={{
                             background: '#ffffff',
                             border: '1px solid #e2e8f0',
                             boxShadow: '0 4px 24px rgba(148, 163, 184, 0.1), 0 1px 4px rgba(148, 163, 184, 0.06)',
                         }}>

                        {/* Error alert */}
                        {error && (
                            <div className="mb-5 p-3.5 rounded-xl flex items-start gap-3"
                                 style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                                <AlertCircle className="flex-shrink-0 mt-0.5" size={17} style={{ color: '#ef4444' }} />
                                <p className="text-[13px] font-medium" style={{ color: '#dc2626' }}>{error}</p>
                            </div>
                        )}

                        {/* Login form */}
                        <form onSubmit={handleLogin} className="space-y-5">
                            {/* Username */}
                            <div>
                                <label htmlFor="login-username" className="block text-[13px] font-semibold mb-2" style={{ color: '#334155' }}>
                                    Username or Email
                                </label>
                                <div className="relative rounded-xl transition-all duration-200"
                                     style={{
                                         background: '#f8fafc',
                                         border: focusedField === 'username' ? '1.5px solid #f59e0b' : '1.5px solid #e2e8f0',
                                         boxShadow: focusedField === 'username' ? '0 0 0 3px rgba(245, 158, 11, 0.1)' : 'none',
                                     }}>
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                          size={17}
                                          style={{ color: focusedField === 'username' ? '#f59e0b' : '#94a3b8' }} />
                                    <input
                                        id="login-username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onFocus={() => setFocusedField('username')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-4 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                        style={{ color: '#1e293b' }}
                                        placeholder="Enter your username or email"
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
                                         background: '#f8fafc',
                                         border: focusedField === 'password' ? '1.5px solid #f59e0b' : '1.5px solid #e2e8f0',
                                         boxShadow: focusedField === 'password' ? '0 0 0 3px rgba(245, 158, 11, 0.1)' : 'none',
                                     }}>
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 transition-colors duration-200"
                                          size={17}
                                          style={{ color: focusedField === 'password' ? '#f59e0b' : '#94a3b8' }} />
                                    <input
                                        id="login-password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full bg-transparent rounded-xl py-3.5 pl-12 pr-12 outline-none text-[15px] font-medium placeholder:text-slate-400"
                                        style={{ color: '#1e293b' }}
                                        placeholder="Enter your password"
                                        required
                                        autoComplete="current-password"
                                    />
                                    <button type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                                            style={{ color: '#94a3b8' }}
                                            tabIndex={-1}>
                                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                    </button>
                                </div>
                            </div>

                            {/* Sign in button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3.5 rounded-xl text-[15px] font-bold text-white flex items-center justify-center gap-2.5 transition-all duration-200 group mt-1"
                                style={{
                                    background: loading ? '#92600a' : 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                                    boxShadow: loading ? 'none' : '0 4px 16px rgba(245, 158, 11, 0.3)',
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

                        {/* Divider — DEV ONLY */}
                        {IS_DEV && (
                        <div className="flex items-center gap-4 my-5">
                            <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} />
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#94a3b8' }}>or</span>
                            <div className="flex-1 h-px" style={{ background: '#e2e8f0' }} />
                        </div>
                        )}

                        {/* Quick Switch — DEV ONLY */}
                        {IS_DEV && (<button
                            onClick={() => setShowQuickSwitch(!showQuickSwitch)}
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200"
                            style={{
                                background: showQuickSwitch ? 'rgba(245, 158, 11, 0.06)' : '#f8fafc',
                                border: showQuickSwitch ? '1.5px dashed rgba(245, 158, 11, 0.4)' : '1.5px dashed #e2e8f0',
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                                     style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                                    <Users size={15} style={{ color: '#f59e0b' }} />
                                </div>
                                <div className="text-left">
                                    <div className="text-[12px] font-bold" style={{ color: '#334155' }}>Quick Switch</div>
                                    <div className="text-[10px] font-medium" style={{ color: '#94a3b8' }}>Development mode</div>
                                </div>
                            </div>
                            {showQuickSwitch
                                ? <ChevronUp size={17} style={{ color: '#64748b' }} />
                                : <ChevronDown size={17} style={{ color: '#64748b' }} />
                            }
                        </button>
                        )}

                        {/* Quick Switch Panel */}
                        {showQuickSwitch && (
                            <div className="mt-3 p-4 rounded-xl"
                                 style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                <p className="text-[11px] font-medium mb-3" style={{ color: '#94a3b8' }}>Click to sign in as a test user</p>

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
                                                    background: switchingUser === user.username ? 'rgba(245, 158, 11, 0.08)' : '#ffffff',
                                                    border: switchingUser === user.username ? '1.5px solid rgba(245, 158, 11, 0.3)' : '1.5px solid #e2e8f0',
                                                    opacity: switchingUser && switchingUser !== user.username ? 0.4 : 1,
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                                         style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(234,88,12,0.2))', color: '#d97706' }}>
                                                        {user.name?.substring(0, 2).toUpperCase() || user.username.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div className="overflow-hidden flex-1 min-w-0">
                                                        <div className="text-[11px] font-bold truncate" style={{ color: '#334155' }}>{user.name || user.username}</div>
                                                        <div className="text-[9px] truncate font-medium" style={{ color: '#94a3b8' }}>@{user.username}</div>
                                                    </div>
                                                    {switchingUser === user.username && (
                                                        <Loader2 size={13} className="animate-spin flex-shrink-0" style={{ color: '#f59e0b' }} />
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[9px] mt-3 text-center font-medium" style={{ color: '#92400e' }}>⚠ Development mode only — not visible in production</p>
                            </div>
                        )}
                    </div>


                </div>
            </div>

            {/* ── Bold Geometric Accent (Relantern branded) ── */}
            <div className="relative z-0" style={{ height: '180px' }}>
                {/* Primary amber shape */}
                <div className="absolute inset-0"
                     style={{
                         background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                         clipPath: 'polygon(0 45%, 100% 0%, 100% 100%, 0% 100%)',
                     }} />
                {/* Overlay pattern for depth */}
                <div className="absolute inset-0 opacity-10"
                     style={{
                         clipPath: 'polygon(0 45%, 100% 0%, 100% 100%, 0% 100%)',
                         backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.3) 1px, transparent 0)',
                         backgroundSize: '24px 24px',
                     }} />
                {/* Content on the accent */}
                <div className="absolute bottom-12 sm:bottom-16 left-0 right-0 flex items-center justify-center z-10 px-6">
                    <div className="flex flex-wrap justify-center gap-3">
                        {[
                            { icon: Shield, label: 'ISO 55000 Compliant' },
                            { icon: Cpu, label: 'AI-Powered Reliability' },
                            { icon: BarChart3, label: '16 Integrated Modules' },
                            { icon: Wrench, label: 'FMEA / RCM / RBI' },
                        ].map(pill => (
                            <div key={pill.label}
                                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                                 style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)' }}>
                                <pill.icon size={13} style={{ color: '#92400e' }} />
                                <span className="text-[11px] font-bold" style={{ color: '#78350f' }}>{pill.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
