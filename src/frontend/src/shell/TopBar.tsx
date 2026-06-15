import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Grid, LogOut, ChevronDown, Shield, Sparkles, User as UserIcon, Menu, Monitor } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { NotificationCenter } from '../components/shell/NotificationCenter';
import { ReliabilityPresenceWidget } from '../components/shell/ReliabilityPresenceWidget';

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-blue-50 text-blue-600 border-blue-200',
    engineer: 'bg-cyan-50 text-cyan-600 border-cyan-200',
    planner: 'bg-sky-50 text-sky-600 border-sky-200',
    technician: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    supervisor: 'bg-relantern-50 text-relantern-700 border-relantern-200',
    manager: 'bg-orange-50 text-orange-600 border-orange-200',
    viewer: 'bg-slate-50 text-slate-500 border-slate-200',
    safety_officer: 'bg-red-50 text-red-600 border-red-200',
};

interface TopBarProps {
    onToggleSidebar: () => void;
    onTogglePreview?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar, onTogglePreview }) => {
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
        <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-3 md:px-6 z-10 w-full shadow-sm">
            {/* Left: Hamburger (mobile) + Breadcrumb */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                    onClick={onToggleSidebar}
                    className="md:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors flex-shrink-0"
                    aria-label="Toggle sidebar"
                >
                    <Menu size={20} />
                </button>
                {/* Mobile: compact brand */}
                <span className="sm:hidden text-sm font-bold text-slate-800 tracking-wide truncate">IRAMS</span>
                {/* Desktop: breadcrumb */}
                <h2 className="hidden sm:block text-sm md:text-lg font-medium tracking-wide text-slate-800 truncate">
                    Dashboard <span className="text-slate-300 mx-1">/</span> <span className="text-slate-500">Overview</span>
                </h2>
            </div>

            {/* Right: Global Actions */}
            <div className="flex items-center gap-2 md:gap-4">
                {/* Search — hidden on mobile, visible sm+ */}
                <div className="relative hidden sm:block">
                    <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search IRAMS..."
                        className="bg-slate-50 border border-slate-200 rounded-lg text-sm pl-9 pr-4 py-1.5 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30 w-40 md:w-56 text-slate-800 placeholder-slate-400 transition-all"
                    />
                </div>

                <NotificationCenter />

                <ReliabilityPresenceWidget />

                {/* AI CoPilot Toggle — Relantern branded, hidden on small mobile */}
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('toggle-copilot'))}
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-relantern-50 hover:bg-relantern-100 border border-relantern-200 text-relantern-700 hover:text-relantern-800 transition-all shadow-sm"
                    title="Relantern CoPilot · AI Coach"
                >
                    <Sparkles size={15} />
                    <span className="font-bold text-xs hidden md:inline">CoPilot</span>
                </button>

                {/* Device Preview Toggle */}
                {onTogglePreview && (
                    <button 
                        onClick={onTogglePreview}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 hover:text-blue-700 transition-all shadow-sm hidden sm:flex"
                        title="Toggle Device Previewer"
                    >
                        <Monitor size={15} />
                        <span className="font-bold text-xs hidden md:inline">Preview</span>
                    </button>
                )}

                <button className="text-slate-400 hover:text-slate-700 transition-colors hidden lg:block">
                    <Grid size={18} />
                </button>

                {/* User Menu Trigger */}
                <div className="relative">
                    <button
                        ref={triggerRef}
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-relantern-400 to-relantern-600 border border-relantern-500/30 flex items-center justify-center text-xs font-bold text-white shadow-sm">
                            {initials}
                        </div>
                        {user && (
                            <div className="hidden lg:flex items-center gap-1.5">
                                <span className="text-sm text-slate-700 font-medium">{user.full_name}</span>
                                <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[user.role] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                    {user.role}
                                </span>
                                <ChevronDown size={14} className={`text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                            </div>
                        )}
                    </button>
                </div>

                {/* Dropdown Portal — renders outside overflow-hidden ancestors */}
                {menuOpen && user && createPortal(
                    <div
                        ref={menuRef}
                        className="fixed w-64 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 z-[9999] animate-in slide-in-from-top-2 duration-150"
                        style={{ top: dropdownPos.top, right: dropdownPos.right }}
                    >
                        <div
                            className="p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors rounded-t-xl"
                            onClick={() => { setMenuOpen(false); navigate(`/contacts?id=${user.contactId}`); }}
                            title="View my profile in People module"
                        >
                            <p className="text-sm font-semibold text-slate-800">{user.full_name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
                            <div className="flex items-center gap-2 mt-2">
                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[user.role] || 'bg-slate-50 text-slate-500'}`}>
                                    {user.role}
                                </span>
                                {user.departments.map(d => (
                                    <span key={d} className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{d}</span>
                                ))}
                            </div>
                        </div>

                        <div className="p-2">
                            <button
                                onClick={() => { setMenuOpen(false); navigate(`/contacts?id=${user.contactId}`); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-800 rounded-lg transition-colors"
                            >
                                <UserIcon size={14} />
                                My Profile
                            </button>
                            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-800 rounded-lg transition-colors">
                                <Shield size={14} />
                                Security Settings
                            </button>
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
