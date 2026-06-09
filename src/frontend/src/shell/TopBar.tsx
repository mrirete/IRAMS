import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Grid, LogOut, ChevronDown, Shield, Sparkles, User as UserIcon, Menu, Monitor } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { NotificationCenter } from '../components/shell/NotificationCenter';
import { ReliabilityPresenceWidget } from '../components/shell/ReliabilityPresenceWidget';

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    engineer: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    planner: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    technician: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    supervisor: 'bg-relantern-500/20 text-relantern-300 border-relantern-500/40',
    manager: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    viewer: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    safety_officer: 'bg-red-500/20 text-red-300 border-red-500/40',
};

interface TopBarProps {
    onToggleAgentPanel: () => void;
    onToggleSidebar: () => void;
    onTogglePreview?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleAgentPanel, onToggleSidebar, onTogglePreview }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

    // Close menu on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Compute dropdown position when menu opens
    useEffect(() => {
        if (menuOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setDropdownPos({
                top: rect.bottom + 8,
                right: window.innerWidth - rect.right,
            });
        }
    }, [menuOpen]);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const initials = user?.full_name
        ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '??';

    return (
        <header className="h-14 md:h-16 bg-brand-800 border-b border-brand-700/60 flex items-center justify-between px-3 md:px-6 z-10 w-full">
            {/* Left: Hamburger (mobile) + Breadcrumb */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                    onClick={onToggleSidebar}
                    className="md:hidden p-2 rounded-lg hover:bg-brand-700 text-brand-300 transition-colors flex-shrink-0"
                    aria-label="Toggle sidebar"
                >
                    <Menu size={20} />
                </button>
                {/* Mobile: compact brand */}
                <span className="sm:hidden text-sm font-bold text-brand-100 tracking-wide truncate">IRAMS</span>
                {/* Desktop: breadcrumb */}
                <h2 className="hidden sm:block text-sm md:text-lg font-medium tracking-wide text-brand-100 truncate">
                    Dashboard <span className="text-brand-500 mx-1">/</span> <span className="text-brand-300">Overview</span>
                </h2>
            </div>

            {/* Right: Global Actions */}
            <div className="flex items-center gap-2 md:gap-4">
                {/* Search */}
                <div className="relative hidden sm:block">
                    <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-brand-400" />
                    <input
                        type="text"
                        placeholder="Search IRAMS..."
                        className="bg-brand-900 border border-brand-600 rounded-lg text-sm pl-9 pr-4 py-1.5 focus:outline-none focus:border-relantern-500 focus:ring-1 focus:ring-relantern-500/30 w-40 md:w-56 text-brand-100 placeholder-brand-500 transition-all"
                    />
                </div>

                <NotificationCenter />

                <ReliabilityPresenceWidget />

                {/* AI Panel Toggle — Relantern branded */}
                <button
                    onClick={onToggleAgentPanel}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-relantern-500/15 hover:bg-relantern-500/25 border border-relantern-500/30 text-relantern-300 hover:text-relantern-200 transition-all shadow-sm"
                    title="Reliability Specialist"
                >
                    <Sparkles size={15} />
                    <span className="font-bold text-xs hidden md:inline">AI</span>
                </button>

                {/* Device Preview Toggle */}
                {onTogglePreview && (
                    <button 
                        onClick={onTogglePreview}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 transition-all shadow-sm hidden sm:flex"
                        title="Toggle Device Previewer"
                    >
                        <Monitor size={15} />
                        <span className="font-bold text-xs hidden md:inline">Preview</span>
                    </button>
                )}

                <button className="text-brand-400 hover:text-brand-100 transition-colors hidden md:block">
                    <Grid size={18} />
                </button>

                {/* User Menu Trigger */}
                <div className="relative">
                    <button
                        ref={triggerRef}
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-brand-700/60 transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-relantern-400 to-relantern-600 border border-relantern-500/30 flex items-center justify-center text-xs font-bold text-white shadow-sm">
                            {initials}
                        </div>
                        {user && (
                            <div className="hidden lg:flex items-center gap-1.5">
                                <span className="text-sm text-brand-100 font-medium">{user.full_name}</span>
                                <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[user.role] || 'bg-brand-700 text-brand-300 border-brand-600'}`}>
                                    {user.role}
                                </span>
                                <ChevronDown size={14} className={`text-brand-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                            </div>
                        )}
                    </button>
                </div>

                {/* Dropdown Portal — renders outside overflow-hidden ancestors */}
                {menuOpen && user && createPortal(
                    <div
                        ref={menuRef}
                        className="fixed w-64 bg-brand-800 border border-brand-600 rounded-xl shadow-2xl shadow-black/50 z-[9999] animate-in slide-in-from-top-2 duration-150"
                        style={{ top: dropdownPos.top, right: dropdownPos.right }}
                    >
                        <div
                            className="p-4 border-b border-brand-700 cursor-pointer hover:bg-brand-700/50 transition-colors rounded-t-xl"
                            onClick={() => { setMenuOpen(false); navigate(`/contacts?id=${user.contactId}`); }}
                            title="View my profile in People module"
                        >
                            <p className="text-sm font-semibold text-brand-50">{user.full_name}</p>
                            <p className="text-xs text-brand-400 mt-0.5">{user.email}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[user.role] || 'bg-brand-700 text-brand-300'}`}>
                                    {user.role}
                                </span>
                                {user.departments.map(d => (
                                    <span key={d} className="text-[10px] text-brand-300 bg-brand-900 px-1.5 py-0.5 rounded">{d}</span>
                                ))}
                            </div>
                        </div>

                        <div className="p-2">
                            <button
                                onClick={() => { setMenuOpen(false); navigate(`/contacts?id=${user.contactId}`); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-200 hover:bg-brand-700 hover:text-brand-50 rounded-lg transition-colors"
                            >
                                <UserIcon size={14} />
                                My Profile
                            </button>
                            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-200 hover:bg-brand-700 hover:text-brand-50 rounded-lg transition-colors">
                                <Shield size={14} />
                                Security Settings
                            </button>
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                                <LogOut size={14} />
                                Sign Out
                            </button>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        </header>
    );
};
