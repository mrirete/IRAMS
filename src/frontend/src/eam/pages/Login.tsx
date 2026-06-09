import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Lock, Mail, AlertCircle, Loader2, Users, ChevronDown, ChevronUp, Flame } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { User, Contact } from '../types';

// Test password for quick switch (development only)
const TEST_PASSWORD = 'Password123!';

export const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [switchingUser, setSwitchingUser] = useState<string | null>(null);
    const [showQuickSwitch, setShowQuickSwitch] = useState(true);
    // Initialize empty - will load from database
    const [testUsers, setTestUsers] = useState<{ username: string; name: string; role: string }[]>([]);
    const navigate = useNavigate();
    const location = useLocation();

    const from = (location.state as any)?.from?.pathname || '/';

    // Load available users for quick switch
    useEffect(() => {
        const loadUsers = async () => {
            setLoadingUsers(true);

            // Fallback: empty — DB is the source of truth
            const fallbackUsers: { username: string; name: string; role: string }[] = [];

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
                    // No users from DB (likely RLS blocking unauthenticated access)
                    console.log("Using fallback users (DB returned empty)");
                    setTestUsers(fallbackUsers);
                }
            } catch (e) {
                console.error("Could not load test users from DB:", e);
                setTestUsers(fallbackUsers);
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
        // Virtual Email Construction for Username Login
        // ALWAYS use lowercase to ensure case-insensitive matching
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
            // First sign out current user
            await supabase.auth.signOut();

            // Then sign in as selected user with test password
            await loginWithUsername(targetUsername, TEST_PASSWORD);
            navigate(from, { replace: true });
        } catch (err: any) {
            console.error("Quick switch failed", err);
            const isInvalidCreds = err.message?.toLowerCase().includes('invalid login credentials');
            if (isInvalidCreds) {
                setError(`No auth account for "${targetUsername}". This user may need to be provisioned in Supabase Auth (run migration 0141 or create via Admin).`);
            } else {
                setError(`Failed to switch to ${targetUsername}: ${err.message}`);
            }
        } finally {
            setSwitchingUser(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-relantern-500/20 rounded-full blur-3xl"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-600/20 rounded-full blur-3xl"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-relantern-500/5 rounded-full blur-3xl"></div>
            </div>

            <div className="w-full max-w-md relative z-10 space-y-4">
                {/* Main Login Card */}
                <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-5 sm:p-8">
                        {/* Logo + Brand Hero */}
                        <div className="flex flex-col items-center mb-8">
                            <div className="h-16 w-16 bg-gradient-to-br from-relantern-500 to-relantern-700 rounded-2xl flex items-center justify-center shadow-lg shadow-relantern-500/30 transform rotate-3 mb-5">
                                <Flame className="text-white" size={32} />
                            </div>

                            {/* IRAMS Acronym Breakdown */}
                            <div className="w-full space-y-1 sm:space-y-1.5 mb-4">
                                {([
                                    { letter: 'I', word: 'Integrated' },
                                    { letter: 'R', word: 'Reliability' },
                                    { letter: 'A', word: 'Asset' },
                                    { letter: 'M', word: 'Management' },
                                    { letter: 'S', word: 'Specialist' },
                                ] as { letter: string; word: string }[]).map(({ letter, word }) => (
                                    <div key={letter} className="flex items-center gap-2 sm:gap-3">
                                        <span className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0 rounded-lg bg-relantern-500/20 border border-relantern-500/40 flex items-center justify-center text-relantern-300 font-black text-sm sm:text-base leading-none">
                                            {letter}
                                        </span>
                                        <span className="text-xs sm:text-sm text-slate-300 font-medium tracking-wide">{word}</span>
                                        <div className="flex-1 h-px bg-slate-700/60"></div>
                                    </div>
                                ))}
                            </div>

                            <p className="text-[11px] font-semibold text-relantern-400/80 uppercase tracking-widest">by Relantern — AI-Powered EAM Platform</p>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6 flex items-start gap-3">
                                <AlertCircle className="text-red-500 mt-0.5" size={18} />
                                <p className="text-sm text-red-200">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleLogin} className="space-y-5">
                            <div className="space-y-1.5">
                                <label htmlFor="username" className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">Username</label>
                                <div className="relative group">
                                    <Mail className="absolute left-3 top-3 text-slate-500 group-focus-within:text-relantern-400 transition" size={18} aria-hidden="true" />
                                    <input
                                        id="username"
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-relantern-500/50 focus:border-relantern-500 outline-none transition"
                                        placeholder="Enter username"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label htmlFor="password" className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">Password</label>
                                <div className="relative group">
                                    <Lock className="absolute left-3 top-3 text-slate-500 group-focus-within:text-relantern-400 transition" size={18} aria-hidden="true" />
                                    <input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-relantern-500/50 focus:border-relantern-500 outline-none transition"
                                        placeholder="Enter password"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-end">
                                <a href="#" className="text-sm text-relantern-400 hover:text-relantern-300 transition">Forgot password?</a>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full bg-relantern-500 hover:bg-relantern-400 text-white font-bold py-3 rounded-xl shadow-lg shadow-relantern-500/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                            >
                                {loading && <Loader2 className="animate-spin" size={20} />}
                                {loading ? 'Signing in...' : 'Sign In'}
                            </button>
                        </form>
                    </div>

                    <div className="p-4 bg-slate-900/50 border-t border-slate-700/50 text-center">
                        <p className="text-slate-500 text-sm">Don't have an account? <span className="text-slate-400">Contact IT Support</span></p>
                    </div>
                </div>

                {/* Quick Switch Card (Dev/Test Mode) */}
                <div className="bg-slate-800/60 backdrop-blur-xl border border-amber-500/30 rounded-2xl shadow-xl overflow-hidden">
                    <button
                        onClick={() => setShowQuickSwitch(!showQuickSwitch)}
                        className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-700/30 transition"
                        aria-expanded={showQuickSwitch}
                        aria-controls="quick-switch-panel"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                                <Users size={16} className="text-amber-400" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="text-sm font-semibold text-amber-300">Quick Switch User</div>
                                <div className="text-xs text-slate-500">Development / Testing Mode</div>
                            </div>
                        </div>
                        {showQuickSwitch ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
                    </button>

                    {showQuickSwitch && (
                        <div id="quick-switch-panel" className="p-4 pt-0 border-t border-slate-700/50">
                            <p className="text-xs text-slate-500 mb-3">Click a user to instantly sign in (uses test password)</p>

                            {loadingUsers ? (
                                <div className="flex items-center justify-center py-6 text-slate-500">
                                    <Loader2 size={20} className="animate-spin mr-2" />
                                    <span className="text-sm">Loading users...</span>
                                </div>
                            ) : testUsers.length === 0 ? (
                                <div className="text-center py-6 text-slate-500 text-sm">
                                    No users found in database
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                                    {testUsers.map(user => (
                                        <button
                                            key={user.username}
                                            onClick={() => handleQuickSwitch(user.username)}
                                            disabled={!!switchingUser}
                                            className={`p-3 rounded-lg border text-left transition-all ${switchingUser === user.username
                                                ? 'bg-relantern-500/20 border-blue-500 text-blue-300'
                                                : 'bg-slate-900/50 border-slate-700 hover:border-slate-500 hover:bg-slate-700/50'
                                                } ${switchingUser && switchingUser !== user.username ? 'opacity-50' : ''}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-400">
                                                    {user.name?.substring(0, 2).toUpperCase() || user.username.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div className="overflow-hidden flex-1">
                                                    <div className="text-sm font-medium text-slate-200 truncate">{user.name || user.username}</div>
                                                    <div className="text-xs text-slate-500 truncate">@{user.username}</div>
                                                </div>
                                                {switchingUser === user.username && (
                                                    <Loader2 size={14} className="animate-spin text-blue-400" />
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            <p className="text-[10px] text-amber-500/60 mt-3 text-center">⚠️ This feature is for testing only. Remove in production.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
