import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Wrench, Zap, ShieldAlert, Clock, CheckSquare, Package } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { useUnreadNotifications } from '../../hooks/useUnreadNotifications';
import { notificationRoute } from '../../lib/notificationNav';

// ─────────────────────────────────────────────────────────
//  Live Alert Feed — the user's real notifications
//  (was a hardcoded mock until the comm-loop closeout)
// ─────────────────────────────────────────────────────────

const FEED_LIMIT = 8;

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

const SEVERITY_STYLES: Record<string, string> = {
    CRITICAL: 'bg-red-500/15 border-red-500/40 text-red-500',
    WARNING: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600',
    SUCCESS: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    INFO: 'bg-white/50 border-slate-200 text-slate-500',
};

function typeIcon(type: string): React.ReactNode {
    switch (type) {
        case 'SAFETY_ALERT':
        case 'EMERGENCY':
        case 'COMPLIANCE_ALERT': return <ShieldAlert size={14} />;
        case 'ASSIGNMENT':
        case 'SCHEDULE_ALERT': return <Wrench size={14} />;
        case 'APPROVAL_REQUIRED': return <CheckSquare size={14} />;
        case 'INVENTORY_ALERT': return <Package size={14} />;
        default: return <Zap size={14} />;
    }
}

export const AlertFeed: React.FC = () => {
    const { user } = useAuth() as any;
    const userId = user?.id;
    const navigate = useNavigate();
    const [items, setItems] = useState<any[]>([]);
    const [loaded, setLoaded] = useState(false);

    const fetchFeed = useCallback(async () => {
        if (!userId) return;
        try {
            const data = await DatabaseService.getInstance().getNotifications(userId, { limit: FEED_LIMIT });
            setItems(data);
        } catch (e) {
            console.warn('[AlertFeed] fetch failed:', e);
        } finally {
            setLoaded(true);
        }
    }, [userId]);

    useEffect(() => { fetchFeed(); }, [fetchFeed]);
    // Realtime (0200) keeps the feed live; the hook also covers focus/poll fallback.
    useUnreadNotifications(userId, fetchFeed);

    const openItem = (n: any) => {
        const route = notificationRoute(n);
        if (route) navigate(route);
        else navigate('/notifications');
    };

    const urgentCount = items.filter(n => n.severity === 'CRITICAL' && !n.isRead).length;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
                        <Bell size={20} />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-slate-800">Live Alert Feed</h3>
                        <p className="text-xs text-slate-400">
                            {items.length === 0 ? 'No notifications' : `${items.length} recent · ${items.filter(n => !n.isRead).length} unread`}
                        </p>
                    </div>
                </div>
                {urgentCount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/30 rounded-full text-xs text-red-400 font-bold animate-pulse">
                        <AlertTriangle size={12} /> {urgentCount} urgent
                    </div>
                )}
            </div>

            <div className="space-y-2 overflow-y-auto flex-1 max-h-[320px] pr-1 scrollbar-thin scrollbar-thumb-brand-700 scrollbar-track-transparent">
                {!loaded ? (
                    <div className="py-8 text-center">
                        <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="py-8 text-center">
                        <Bell size={24} className="mx-auto mb-2 text-slate-200" />
                        <p className="text-xs text-slate-400">All quiet — alerts and assignments will appear here.</p>
                    </div>
                ) : (
                    items.map((n, idx) => (
                        <div
                            key={n.id}
                            onClick={() => openItem(n)}
                            className={`border rounded-lg p-3 transition-all hover:scale-[1.01] cursor-pointer ${SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.INFO} ${!n.isRead ? '' : 'opacity-70'}`}
                            style={{ animationDelay: `${idx * 60}ms` }}
                        >
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 opacity-70">{typeIcon(n.notificationType)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className={`text-sm truncate ${!n.isRead ? 'font-semibold' : 'font-medium'}`}>{n.title}</p>
                                        <div className="flex items-center gap-1 text-[10px] opacity-60 shrink-0">
                                            <Clock size={10} />
                                            {relativeTime(n.createdAt)}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        {n.entityNumber && (
                                            <span className="text-[10px] font-bold bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50 text-slate-500">{n.entityNumber}</span>
                                        )}
                                        <p className="text-[11px] opacity-70 truncate">{n.message}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
