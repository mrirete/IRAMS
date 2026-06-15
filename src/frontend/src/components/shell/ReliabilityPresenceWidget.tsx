import React, { useState, useRef, useEffect } from 'react';
import { useReliabilityPresence, type ReliabilityPresenceUser } from '../../hooks/useReliabilityPresence';
import { Users, Radio, MapPin, Activity, X, ShieldAlert, Sparkles, MessageSquare } from 'lucide-react';
import { createPortal } from 'react-dom';

const ROLE_BADGE_CLASSES: Record<string, string> = {
    ADMIN: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    SYS_ADMIN: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    ENGINEER: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    RELIABILITY_ENG: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    PLANNER: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    TECHNICIAN: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    SUPERVISOR: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    MANAGER: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    VIEWER: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    SAFETY_OFFICER: 'bg-red-500/20 text-red-300 border-red-500/40',
};

const ROLE_AVATAR_GRADIENTS: Record<string, string> = {
    ADMIN: 'from-blue-500 to-blue-600',
    SYS_ADMIN: 'from-blue-500 to-blue-600',
    ENGINEER: 'from-cyan-500 to-blue-600',
    RELIABILITY_ENG: 'from-cyan-500 to-blue-600',
    PLANNER: 'from-blue-500 to-sky-600',
    TECHNICIAN: 'from-emerald-500 to-teal-600',
    SUPERVISOR: 'from-amber-500 to-red-500',
    MANAGER: 'from-orange-500 to-amber-600',
    VIEWER: 'from-slate-500 to-zinc-600',
    SAFETY_OFFICER: 'from-red-500 to-rose-600',
};

function getRoleAvatarGradient(role: string): string {
    const key = (role || '').toUpperCase().replace(/[\s-]/g, '_');
    return ROLE_AVATAR_GRADIENTS[key] || 'from-slate-500 to-zinc-600';
}

function getRoleBadgeClass(role: string): string {
    const key = (role || '').toUpperCase().replace(/[\s-]/g, '_');
    return ROLE_BADGE_CLASSES[key] || 'bg-slate-500/20 text-slate-300 border-slate-500/40';
}

function getInitials(name: string): string {
    if (!name) return '??';
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

export const ReliabilityPresenceWidget: React.FC = () => {
    const { onlineUsers, isReliabilityRoute, isConnecting, currentUser } = useReliabilityPresence();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
    
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Update dropdown position relative to trigger button
    useEffect(() => {
        if (dropdownOpen && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setDropdownPos({
                top: rect.bottom + 8,
                right: window.innerWidth - rect.right,
            });
        }
    }, [dropdownOpen]);

    // Do not render anything if we are not on a Reliability page
    if (!isReliabilityRoute) return null;

    const handleWidgetClick = () => {
        if (window.innerWidth < 768) {
            setMobileSheetOpen(true);
        } else {
            setDropdownOpen(!dropdownOpen);
        }
    };

    // Filter out current user from "peers" list to show collaboration potential
    const peerUsers = onlineUsers.filter(u => u.userId !== currentUser?.id);
    const totalCount = onlineUsers.length;

    // Render initials list for avatar stack (up to 3 avatars)
    const displayedUsersForStack = onlineUsers.slice(0, 3);
    const overflowCount = totalCount > 3 ? totalCount - 3 : 0;

    return (
        <>
            {/* ── Main Trigger Widget ── */}
            <button
                ref={triggerRef}
                onClick={handleWidgetClick}
                className="flex items-center gap-2 p-1.5 md:px-2.5 md:py-1.5 rounded-lg bg-brand-900 border border-brand-700/60 hover:border-relantern-500/40 hover:bg-brand-800 transition-all group relative cursor-pointer"
                title={`${totalCount} active in Reliability`}
            >
                {/* Real-time sync beacon */}
                <div className="relative flex h-2.5 w-2.5">
                    {totalCount > 1 ? (
                        <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </>
                    ) : (
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-500"></span>
                    )}
                </div>

                {/* Avatar stack — hidden on narrow mobile, beautiful on desktop */}
                {onlineUsers.length > 0 ? (
                    <div className="hidden sm:flex items-center -space-x-1.5">
                        {displayedUsersForStack.map((u, i) => (
                            <div
                                key={u.userId}
                                className={`w-5 h-5 rounded-full bg-gradient-to-br ${getRoleAvatarGradient(u.role)} flex items-center justify-center text-[8px] font-bold text-white border border-brand-800 uppercase shadow-sm select-none`}
                                style={{ zIndex: 10 + i }}
                            >
                                {getInitials(u.fullName)}
                            </div>
                        ))}
                        {overflowCount > 0 && (
                            <div className="w-5 h-5 rounded-full bg-brand-750 flex items-center justify-center text-[8px] font-bold text-relantern-300 border border-brand-800 select-none z-30">
                                +{overflowCount}
                            </div>
                        )}
                    </div>
                ) : (
                    <Users size={14} className="text-brand-400 group-hover:text-brand-200 transition-colors" />
                )}

                {/* Status text */}
                <span className="text-xs font-medium text-brand-300 group-hover:text-brand-100 hidden md:inline">
                    {totalCount > 1 ? `${totalCount} Engineers` : 'Solo Mode'}
                </span>
                
                {isConnecting && (
                    <span className="w-3 h-3 border-2 border-relantern-400 border-t-transparent rounded-full animate-spin" />
                )}
            </button>

            {/* ── Desktop Glassmorphic Popover ── */}
            {dropdownOpen && createPortal(
                <div
                    ref={dropdownRef}
                    className="fixed w-80 bg-brand-850/95 backdrop-blur-lg border border-brand-600/80 rounded-xl shadow-2xl z-[9999] overflow-hidden animate-in fade-in slide-in-from-top-3 duration-150"
                    style={{ top: dropdownPos.top, right: dropdownPos.right }}
                >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-brand-700 bg-brand-900/60 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Radio size={14} className="text-emerald-400 animate-pulse" />
                            <span className="text-xs font-bold text-brand-200 uppercase tracking-widest">Reliability Presence</span>
                        </div>
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold border border-emerald-500/20">
                            {totalCount} Online
                        </span>
                    </div>

                    {/* Users list */}
                    <div className="max-h-80 overflow-y-auto divide-y divide-brand-700/50">
                        {onlineUsers.map(user => {
                            const isSelf = user.userId === currentUser?.id;
                            return (
                                <div
                                    key={user.userId}
                                    className="p-3 hover:bg-brand-750/40 transition-colors flex gap-3 group/item cursor-default"
                                >
                                    {/* Avatar with dynamic role gradient & pulsing indicator */}
                                    <div className="relative flex-shrink-0">
                                        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${getRoleAvatarGradient(user.role)} flex items-center justify-center text-xs font-bold text-white shadow-md border border-brand-600 select-none`}>
                                            {getInitials(user.fullName)}
                                        </div>
                                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-brand-850 shadow-sm flex items-center justify-center">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        </span>
                                    </div>

                                    {/* User Details */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-1">
                                            <h4 className="text-xs font-semibold text-brand-50 truncate leading-tight flex items-center gap-1.5">
                                                {user.fullName}
                                                {isSelf && (
                                                    <span className="text-[9px] font-bold text-relantern-400 bg-primary-600/10 px-1.5 py-0.2 rounded border border-relantern-500/20 uppercase tracking-wider scale-90">
                                                        You
                                                    </span>
                                                )}
                                            </h4>
                                        </div>
                                        <p className="text-[10px] text-brand-400 font-mono mt-0.5 truncate">
                                            @{user.username}
                                        </p>
                                        
                                        {/* Activity Context indicator */}
                                        {user.activePage && (
                                            <div className="mt-2 flex items-start gap-1 bg-brand-900/60 p-1.5 rounded-lg border border-brand-750">
                                                <Activity size={10} className="text-relantern-400 mt-0.5 flex-shrink-0" />
                                                <span className="text-[10px] text-brand-300 font-medium leading-normal break-words">
                                                    {user.activePage}
                                                </span>
                                            </div>
                                        )}

                                        {/* Role & Department info */}
                                        <div className="flex items-center gap-1.5 mt-2">
                                            <span className={`text-[8px] uppercase font-extrabold px-1.5 py-0.5 rounded border tracking-wider select-none ${getRoleBadgeClass(user.role)}`}>
                                                {user.role}
                                            </span>
                                            {user.department && (
                                                <span className="text-[8px] text-brand-400 font-bold select-none truncate max-w-[80px]">
                                                    {user.department}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Footer */}
                    <div className="p-3 bg-brand-900/40 border-t border-brand-700 text-center">
                        {peerUsers.length === 0 ? (
                            <div className="text-[10px] text-brand-400 px-2 py-1 leading-relaxed">
                                You are the sole Reliability specialist online. Use the **Collaborator Picker** inside investigations to invite peers.
                            </div>
                        ) : (
                            <div className="text-[10px] text-emerald-400/90 font-medium flex items-center justify-center gap-1.5">
                                <Sparkles size={11} className="animate-pulse" />
                                Collaborative Engineering Active
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {/* ── Native Mobile Bottom Sheet Drawer ── */}
            {mobileSheetOpen && createPortal(
                <>
                    {/* Backdrop overlay */}
                    <div
                        className="fixed inset-0 bg-black/60 z-[9998] backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={() => setMobileSheetOpen(false)}
                    />
                    
                    {/* Bottom Drawer */}
                    <div className="fixed inset-x-0 bottom-0 max-h-[85vh] bg-brand-850 border-t border-brand-650 rounded-t-2xl z-[9999] p-4 pb-6 flex flex-col animate-in slide-in-from-bottom duration-300">
                        {/* Drawer handle */}
                        <div className="w-12 h-1 bg-brand-600 rounded-full mx-auto mb-4" />

                        {/* Title Bar */}
                        <div className="flex items-center justify-between pb-3 border-b border-brand-700 mb-2">
                            <div className="flex items-center gap-2">
                                <Radio size={16} className="text-emerald-400 animate-pulse" />
                                <span className="font-bold text-sm text-brand-50 uppercase tracking-widest">Active Engineers</span>
                            </div>
                            <button
                                onClick={() => setMobileSheetOpen(false)}
                                className="p-1 rounded-full hover:bg-brand-700 text-brand-300 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Users List */}
                        <div className="flex-1 overflow-y-auto divide-y divide-brand-700/50 mt-1 max-h-[60vh]">
                            {onlineUsers.map(user => {
                                const isSelf = user.userId === currentUser?.id;
                                return (
                                    <div
                                        key={user.userId}
                                        className="py-3 flex gap-3 align-start"
                                    >
                                        <div className="relative flex-shrink-0">
                                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getRoleAvatarGradient(user.role)} flex items-center justify-center text-xs font-bold text-white shadow-md border border-brand-600 uppercase select-none`}>
                                                {getInitials(user.fullName)}
                                            </div>
                                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-brand-850 shadow-sm" />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <h4 className="text-sm font-semibold text-brand-50 truncate">
                                                    {user.fullName}
                                                </h4>
                                                {isSelf && (
                                                    <span className="text-[8px] font-bold text-relantern-400 bg-primary-600/10 px-1.5 py-0.2 rounded border border-relantern-500/20 uppercase tracking-wider">
                                                        You
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-brand-400 font-mono">
                                                @{user.username}
                                            </p>

                                            {user.activePage && (
                                                <div className="mt-1.5 flex items-start gap-1.5 bg-brand-900/60 p-2 rounded-lg border border-brand-750">
                                                    <Activity size={12} className="text-relantern-400 mt-0.5 flex-shrink-0" />
                                                    <span className="text-xs text-brand-300 leading-normal">
                                                        {user.activePage}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-1.5 mt-2">
                                                <span className={`text-[8px] uppercase font-extrabold px-1.5 py-0.5 rounded border tracking-wider select-none ${getRoleBadgeClass(user.role)}`}>
                                                    {user.role}
                                                </span>
                                                {user.department && (
                                                    <span className="text-[9px] text-brand-400 font-medium">
                                                        {user.department}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {/* Info Footer */}
                        <div className="mt-4 pt-3 border-t border-brand-700 text-center">
                            <span className="text-[10px] text-brand-400 leading-relaxed block">
                                Reliability presence tracking compliance active. Complies with IEC 62443 cyber-security standards.
                            </span>
                        </div>
                    </div>
                </>,
                document.body
            )}
        </>
    );
};
