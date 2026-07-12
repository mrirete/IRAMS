import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bell, Wrench, Zap, ShieldAlert, Clock, Check, CheckCheck, ExternalLink, Package, BarChart3, FileText, Shield, CheckSquare, X, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../eam/contexts/ToastContext';
import { notificationRoute, isApprovableRequest } from '../../lib/notificationNav';

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'Yesterday' : `${days}d ago`;
}

// Map DB severity → dot color
const SEVERITY_DOT: Record<string, string> = {
    CRITICAL: 'bg-red-500',
    WARNING: 'bg-yellow-500',
    INFO: 'bg-blue-400',
    SUCCESS: 'bg-green-500',
};

// Map notification type → icon
function getTypeIcon(type: string): React.ReactNode {
    switch (type) {
        case 'SAFETY_ALERT': return <ShieldAlert size={14} className="text-red-400" />;
        case 'SCHEDULE_ALERT': return <Clock size={14} className="text-blue-500" />;
        case 'ASSIGNMENT': return <Wrench size={14} className="text-blue-500" />;
        case 'STATUS_CHANGE': return <Zap size={14} className="text-yellow-500" />;
        case 'APPROVAL_REQUIRED': return <CheckSquare size={14} className="text-blue-500" />;
        case 'INVENTORY_ALERT': return <Package size={14} className="text-amber-500" />;
        case 'SLA_BREACH': return <Zap size={14} className="text-red-500" />;
        case 'COST_THRESHOLD': return <BarChart3 size={14} className="text-emerald-500" />;
        case 'AI_RECOMMENDATION': return <Zap size={14} className="text-primary-500" />;
        case 'EMERGENCY': return <ShieldAlert size={14} className="text-red-600" />;
        case 'COMPLIANCE_ALERT': return <Shield size={14} className="text-orange-500" />;
        default: return <FileText size={14} className="text-slate-400" />;
    }
}

type TabFilter = 'all' | 'unread' | 'action';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

// ─────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────

export const NotificationCenter: React.FC = () => {
    const { user } = useAuth() as any;
    const userId = user?.id;

    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [tab, setTab] = useState<TabFilter>('all');
    const [loading, setLoading] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // ── Fetch notifications ──────────────────────────────
    const fetchNotifications = useCallback(async () => {
        if (!userId) return;
        const db = DatabaseService.getInstance();
        try {
            const data = await db.getNotifications(userId, { limit: 20 });
            setNotifications(data);
        } catch (e) {
            console.warn('[NotificationCenter] Error fetching:', e);
        }
    }, [userId]);

    const fetchUnreadCount = useCallback(async () => {
        if (!userId) return;
        const db = DatabaseService.getInstance();
        try {
            const count = await db.getUnreadNotificationCount(userId);
            setUnreadCount(count);
        } catch (e) {
            console.warn('[NotificationCenter] Error counting unread:', e);
        }
    }, [userId]);

    // Initial load + polling
    useEffect(() => {
        fetchUnreadCount();

        const interval = setInterval(fetchUnreadCount, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchUnreadCount]);

    // Fetch full list when dropdown opens
    useEffect(() => {
        if (open) {
            setLoading(true);
            fetchNotifications().finally(() => setLoading(false));
        }
    }, [open, fetchNotifications]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Actions ──────────────────────────────────────────
    const markRead = async (id: string) => {
        const db = DatabaseService.getInstance();
        await db.markNotificationRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const markAllRead = async () => {
        if (!userId) return;
        const db = DatabaseService.getInstance();
        await db.markAllNotificationsRead(userId);
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setUnreadCount(0);
    };

    // ── U-5: deep-link + inline approve/reject ───────────────
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [acting, setActing] = useState<string | null>(null);

    const openNotification = (n: any) => {
        if (!n.isRead) markRead(n.id);
        const route = notificationRoute(n);
        setOpen(false);
        if (route) navigate(route);
    };

    const actorName = (user as any)?.username || (user as any)?.full_name || 'user';

    const approveRequest = async (n: any, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Approve this request and convert it to a work order?')) return;
        setActing(n.id);
        try {
            await DatabaseService.getInstance().approveRequestAndConvert(n.entityId, actorName);
            if (userId) await DatabaseService.getInstance().acknowledgeNotification(n.id, actorName);
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true, isAcknowledged: true } : x));
            setUnreadCount(c => Math.max(0, c - (n.isRead ? 0 : 1)));
            showToast('Request approved — work order created.', 'success');
        } catch (err: any) {
            showToast('Approve failed: ' + (err?.message || 'unknown'), 'error');
        } finally { setActing(null); }
    };

    const rejectRequest = async (n: any, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Reject this request?')) return;
        setActing(n.id);
        try {
            await DatabaseService.getInstance().updateRequest(n.entityId, { status: 'REJECTED' } as any, actorName);
            if (userId) await DatabaseService.getInstance().acknowledgeNotification(n.id, actorName);
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true, isAcknowledged: true } : x));
            setUnreadCount(c => Math.max(0, c - (n.isRead ? 0 : 1)));
            showToast('Request rejected.', 'success');
        } catch (err: any) {
            showToast('Reject failed: ' + (err?.message || 'unknown'), 'error');
        } finally { setActing(null); }
    };

    // ── Filter ───────────────────────────────────────────
    const filtered = notifications.filter(n => {
        if (tab === 'unread') return !n.isRead;
        if (tab === 'action') return n.actionRequired && !n.isAcknowledged;
        return true;
    });

    return (
        <div className="relative" ref={ref}>
            {/* Bell Button */}
            <button onClick={() => setOpen(!open)} className="text-slate-400 hover:text-slate-800 relative transition-colors">
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.5)]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <div className="fixed left-2 right-2 top-14 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] bg-white border border-slate-200 rounded-xl shadow-2xl shadow-black/50 z-50 animate-in slide-in-from-top-2 duration-150 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                        <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
                        {unreadCount > 0 && (
                            <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] text-accent-cyan hover:text-primary-300 font-medium transition-colors">
                                <CheckCheck size={12} /> Mark all read
                            </button>
                        )}
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-slate-200">
                        {[
                            { key: 'all' as TabFilter, label: 'All', count: notifications.length },
                            { key: 'unread' as TabFilter, label: 'Unread', count: notifications.filter(n => !n.isRead).length },
                            { key: 'action' as TabFilter, label: 'Action', count: notifications.filter(n => n.actionRequired && !n.isAcknowledged).length },
                        ].map(t => (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === t.key ? 'text-accent-cyan border-b-2 border-accent-cyan' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {t.label} <span className="text-slate-400 ml-0.5">({t.count})</span>
                            </button>
                        ))}
                    </div>

                    {/* Items */}
                    <div className="max-h-[50vh] sm:max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                        {loading ? (
                            <div className="py-8 text-center">
                                <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />
                                <p className="text-xs text-slate-400">Loading...</p>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="py-8 text-center">
                                <Bell size={24} className="mx-auto mb-2 text-slate-200" />
                                <p className="text-xs text-slate-400">
                                    {tab === 'all' ? 'No notifications yet' : tab === 'unread' ? 'All caught up!' : 'No actions required'}
                                </p>
                            </div>
                        ) : (
                            filtered.map(n => (
                                <div
                                    key={n.id}
                                    className={`px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer ${!n.isRead ? 'bg-blue-50/40' : ''}`}
                                    onClick={() => openNotification(n)}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5">{getTypeIcon(n.notificationType)}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {!n.isRead && <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[n.severity] || 'bg-blue-400'}`} />}
                                                <p className={`text-sm truncate ${!n.isRead ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{n.title}</p>
                                            </div>
                                            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                {n.entityNumber && (
                                                    <span className="text-[9px] font-bold bg-slate-50 text-slate-500 px-1 py-0.5 rounded border border-slate-200">{n.entityNumber}</span>
                                                )}
                                                {n.module && (
                                                    <span className="text-[9px] text-slate-400 capitalize">{n.module}</span>
                                                )}
                                                {n.actionRequired && !n.isAcknowledged && (
                                                    <span className="text-[8px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded">ACTION</span>
                                                )}
                                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5 ml-auto">
                                                    <Clock size={9} />{relativeTime(n.createdAt)}
                                                </span>
                                            </div>
                                            {/* U-5: inline approve/reject for approval-required requests */}
                                            {isApprovableRequest(n) && (
                                                <div className="flex items-center gap-2 mt-2">
                                                    <button
                                                        onClick={e => approveRequest(n, e)}
                                                        disabled={acting === n.id}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 px-2.5 py-1 rounded-md"
                                                    >
                                                        {acting === n.id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve
                                                    </button>
                                                    <button
                                                        onClick={e => rejectRequest(n, e)}
                                                        disabled={acting === n.id}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-60 px-2.5 py-1 rounded-md"
                                                    >
                                                        <X size={11} /> Reject
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {!n.isRead && (
                                            <button
                                                onClick={e => { e.stopPropagation(); markRead(n.id); }}
                                                className="p-1 text-slate-400 hover:text-accent-cyan transition-colors flex-shrink-0"
                                                title="Mark as read"
                                            >
                                                <Check size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Footer — View All */}
                    <Link
                        to="/notifications"
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-slate-200 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                        View All Notifications <ExternalLink size={10} />
                    </Link>
                </div>
            )}
        </div>
    );
};
