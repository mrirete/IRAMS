
import React, { useState, useEffect, useCallback } from 'react';
import {
    Bell, CheckCircle, AlertTriangle, Info, Clock,
    Trash2, CheckSquare, Search, ExternalLink,
    Shield, Zap, Package, Wrench, FileText, BarChart3, RefreshCw
} from 'lucide-react';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { aiContextService } from '../services/AIContextService';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/DatabaseService';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { notificationRoute, isApprovableRequest } from '../../lib/notificationNav';

type SeverityFilter = 'ALL' | 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
type TypeFilter = 'ALL' | 'APPROVAL_REQUIRED' | 'ASSIGNMENT' | 'STATUS_CHANGE' | 'SLA_BREACH' | 'INVENTORY_ALERT' | 'SCHEDULE_ALERT' | 'SAFETY_ALERT' | 'COST_THRESHOLD' | 'AI_RECOMMENDATION' | 'SYSTEM';
type ReadFilter = 'ALL' | 'UNREAD' | 'ACTION_REQUIRED';

export const Notifications: React.FC = () => {
    const { profile } = useAuth();
    const [notifications, setNotifications] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
    const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
    const [searchTerm, setSearchTerm] = useState('');

    const loadNotifications = useCallback(async () => {
        if (!profile?.id) return;
        const db = DatabaseService.getInstance();
        try {
            const options: any = { limit: 100 };
            if (readFilter === 'UNREAD') options.unreadOnly = true;
            if (severityFilter !== 'ALL') options.severity = severityFilter;
            if (typeFilter !== 'ALL') options.notificationType = typeFilter;
            const data = await db.getNotifications(profile.id, options);
            setNotifications(data);
        } catch (e) {
            console.error('Failed to load notifications:', e);
        } finally {
            setLoading(false);
        }
    }, [profile?.id, severityFilter, typeFilter, readFilter]);

    useEffect(() => { loadNotifications(); }, [loadNotifications]);

    const handleMarkRead = async (id: string) => {
        const db = DatabaseService.getInstance();
        await db.markNotificationRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n));
    };

    const navigate = useNavigate();
    const { showToast } = useToast();
    const [acting, setActing] = useState<string | null>(null);
    const actorName = (profile as any)?.username || (profile as any)?.fullName || 'user';

    const openDetails = (n: any) => {
        if (!n.isRead) handleMarkRead(n.id);
        const route = notificationRoute(n);
        if (route) navigate(route);
    };
    const approveReq = async (n: any) => {
        if (!window.confirm('Approve this request and convert it to a work order?')) return;
        setActing(n.id);
        try {
            await DatabaseService.getInstance().approveRequestAndConvert(n.entityId, actorName);
            await DatabaseService.getInstance().acknowledgeNotification(n.id, actorName);
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true, isAcknowledged: true } : x));
            showToast('Request approved — work order created.', 'success');
        } catch (e: any) { showToast('Approve failed: ' + (e?.message || 'unknown'), 'error'); }
        finally { setActing(null); }
    };
    const rejectReq = async (n: any) => {
        if (!window.confirm('Reject this request?')) return;
        setActing(n.id);
        try {
            await DatabaseService.getInstance().updateRequest(n.entityId, { status: 'REJECTED' } as any, actorName);
            await DatabaseService.getInstance().acknowledgeNotification(n.id, actorName);
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true, isAcknowledged: true } : x));
            showToast('Request rejected.', 'success');
        } catch (e: any) { showToast('Reject failed: ' + (e?.message || 'unknown'), 'error'); }
        finally { setActing(null); }
    };

    const handleAcknowledge = async (id: string) => {
        if (!profile?.username) return;
        const db = DatabaseService.getInstance();
        await db.acknowledgeNotification(id, profile.username);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isAcknowledged: true, isRead: true } : n));
    };

    const handleMarkAllRead = async () => {
        if (!profile?.id) return;
        const db = DatabaseService.getInstance();
        await db.markAllNotificationsRead(profile.id);
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    };

    const handleDelete = async (id: string) => {
        const db = DatabaseService.getInstance();
        await db.deleteNotification(id);
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const getSeverityIcon = (sev: string) => {
        switch (sev) {
            case 'CRITICAL': return <AlertTriangle className="text-red-500" size={20} />;
            case 'WARNING': return <AlertTriangle className="text-amber-500" size={20} />;
            case 'SUCCESS': return <CheckCircle className="text-green-500" size={20} />;
            default: return <Info className="text-blue-500" size={20} />;
        }
    };

    const getSeverityBg = (sev: string) => {
        switch (sev) {
            case 'CRITICAL': return 'bg-red-50 border-red-200';
            case 'WARNING': return 'bg-amber-50 border-amber-200';
            case 'SUCCESS': return 'bg-green-50 border-green-200';
            default: return 'bg-white border-slate-200';
        }
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'APPROVAL_REQUIRED': return <CheckSquare size={14} className="text-blue-500" />;
            case 'ASSIGNMENT': return <Wrench size={14} className="text-blue-500" />;
            case 'SAFETY_ALERT': return <Shield size={14} className="text-red-500" />;
            case 'INVENTORY_ALERT': return <Package size={14} className="text-amber-500" />;
            case 'SCHEDULE_ALERT': return <Clock size={14} className="text-blue-500" />;
            case 'SLA_BREACH': return <Zap size={14} className="text-red-500" />;
            case 'COST_THRESHOLD': return <BarChart3 size={14} className="text-emerald-500" />;
            case 'AI_RECOMMENDATION': return <Zap size={14} className="text-primary-500" />;
            default: return <FileText size={14} className="text-slate-400" />;
        }
    };

    const timeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return new Date(dateStr).toLocaleDateString();
    };

    // Client-side filters
    const filteredNotifications = notifications.filter(n => {
        if (readFilter === 'ACTION_REQUIRED' && !n.actionRequired) return false;
        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            return (
                n.title?.toLowerCase().includes(search) ||
                n.message?.toLowerCase().includes(search) ||
                n.entityNumber?.toLowerCase().includes(search)
            );
        }
        return true;
    });

    const unreadCount = notifications.filter(n => !n.isRead).length;
    const criticalCount = notifications.filter(n => n.severity === 'CRITICAL' && !n.isAcknowledged).length;

    return (
        <div className="ers-page-form h-[calc(100vh-6rem)] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                        Notifications
                        {unreadCount > 0 && (
                            <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full">{unreadCount} New</span>
                        )}
                        {criticalCount > 0 && (
                            <span className="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full animate-pulse">
                                {criticalCount} Critical
                            </span>
                        )}
                    </h1>
                    <p className="text-slate-500 text-sm">Stay updated with system events, approvals, and alerts.</p>
                </div>
                <div className="flex gap-2">
                    <AskRelanternButton
                        contextType="notifications"
                        contextSummary={aiContextService.buildNotificationsContext({
                            unreadCount,
                            criticalCount,
                            warningCount: notifications.filter(n => n.severity === 'WARNING' && !n.isRead).length,
                        })}
                    />
                    <Button
                        variant="secondary"
                        onClick={() => { setLoading(true); loadNotifications(); }}
                        leftIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
                    >
                        Refresh
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleMarkAllRead}
                        leftIcon={<CheckSquare size={16} />}
                    >
                        Mark all read
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4 items-center">
                {/* Severity */}
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {(['ALL', 'CRITICAL', 'WARNING', 'INFO'] as SeverityFilter[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setSeverityFilter(f)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${severityFilter === f
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>

                {/* Read Status */}
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {(['ALL', 'UNREAD', 'ACTION_REQUIRED'] as ReadFilter[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setReadFilter(f)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition whitespace-nowrap ${readFilter === f
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            {f === 'ACTION_REQUIRED' ? 'ACTION' : f}
                        </button>
                    ))}
                </div>

                {/* Type Filter */}
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium bg-white"
                >
                    <option value="ALL">All Types</option>
                    <option value="APPROVAL_REQUIRED">Approvals</option>
                    <option value="ASSIGNMENT">Assignments</option>
                    <option value="STATUS_CHANGE">Status Changes</option>
                    <option value="SLA_BREACH">SLA Breaches</option>
                    <option value="INVENTORY_ALERT">Inventory</option>
                    <option value="SCHEDULE_ALERT">Schedule</option>
                    <option value="SAFETY_ALERT">Safety</option>
                    <option value="COST_THRESHOLD">Cost</option>
                    <option value="AI_RECOMMENDATION">AI Insights</option>
                </select>

                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Search by title, message, or entity number..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                </div>
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto space-y-3">
                {loading ? (
                    <div className="text-center py-12">
                        <RefreshCw size={32} className="mx-auto mb-4 text-slate-300 animate-spin" />
                        <p className="text-slate-400">Loading notifications...</p>
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                        <Bell size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No notifications found.</p>
                        <p className="text-xs mt-1">Notifications will appear as events occur in the system.</p>
                    </div>
                ) : (
                    filteredNotifications.map(n => (
                        <div
                            key={n.id}
                            className={`p-4 rounded-card border shadow-card hover:shadow-raised transition-all relative group ${getSeverityBg(n.severity)} ${!n.isRead ? 'border-l-4 border-l-primary-600' : ''}`}
                        >
                            <div className="flex items-start gap-4">
                                <div className="mt-1 flex-shrink-0">{getSeverityIcon(n.severity)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-center gap-2">
                                            <h3 className={`text-sm font-bold ${!n.isRead ? 'text-slate-900' : 'text-slate-600'}`}>
                                                {n.title}
                                            </h3>
                                            {getTypeIcon(n.notificationType)}
                                        </div>
                                        <span className="text-xs text-slate-400 whitespace-nowrap flex items-center gap-1">
                                            <Clock size={12} /> {timeAgo(n.createdAt)}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-600 mt-1 mb-2">{n.message}</p>

                                    <div className="flex flex-wrap gap-2 items-center">
                                        {n.entityNumber && (
                                            <span className="text-xs font-mono bg-white/50 px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">
                                                {n.entityNumber}
                                            </span>
                                        )}
                                        {n.module && (
                                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 capitalize">
                                                {n.module}
                                            </span>
                                        )}
                                        {n.actionRequired && !n.isAcknowledged && (
                                            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                                Action Required
                                            </span>
                                        )}
                                        {n.escalationLevel > 0 && (
                                            <span className="text-xs font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                                                Escalated (L{n.escalationLevel})
                                            </span>
                                        )}
                                        {notificationRoute(n) && (
                                            <button
                                                onClick={() => openDetails(n)}
                                                className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                                            >
                                                View Details <ExternalLink size={12} />
                                            </button>
                                        )}
                                    </div>

                                    {/* U-5: inline approve/reject for approval-required requests */}
                                    {isApprovableRequest(n) && (
                                        <div className="flex items-center gap-2 mt-3">
                                            <Button variant="primary" size="sm" onClick={() => approveReq(n)} loading={acting === n.id} leftIcon={<CheckCircle size={14} />}>
                                                Approve &amp; convert
                                            </Button>
                                            <Button variant="secondary" size="sm" onClick={() => rejectReq(n)} disabled={acting === n.id}>
                                                Reject
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col gap-2 items-end flex-shrink-0">
                                    {n.severity === 'CRITICAL' && !n.isAcknowledged && (
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => handleAcknowledge(n.id)}
                                            className="animate-pulse"
                                        >
                                            Acknowledge
                                        </Button>
                                    )}
                                    {!n.isRead && (
                                        <button
                                            onClick={() => handleMarkRead(n.id)}
                                            className="text-xs text-slate-400 hover:text-blue-600"
                                            title="Mark as Read"
                                        >
                                            <CheckCircle size={16} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleDelete(n.id)}
                                        className="text-xs text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
