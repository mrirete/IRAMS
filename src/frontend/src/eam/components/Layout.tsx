import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { Menu, Search, Bell, User, Bot, HelpCircle, LogOut, ChevronDown, CheckCircle, AlertTriangle, Info, Clock, ExternalLink, CheckSquare, Trash2, X, Volume2 } from 'lucide-react';
import { RelanternAI } from './RelanternAI';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { PwaReloadPrompt } from './PwaReloadPrompt';
import { BottomNav } from './BottomNav';
import { NetworkStatusBanner } from './NetworkStatusBanner';
import { PullToRefreshWrapper } from './PullToRefreshWrapper';
import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';

interface LayoutProps {
  children: React.ReactNode;
  nexusContext?: string;
  setNexusContext: (ctx: string | undefined) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, nexusContext, setNexusContext }) => {
  const { profile, signOut, role } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const queryClient = useQueryClient();

  // --- Notification State ---
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // If external context is requested (e.g. from Asset page), open the AI
  React.useEffect(() => {
    if (nexusContext) {
      setAiOpen(true);
    }
  }, [nexusContext]);

  // --- Load Notifications ---
  const loadNotifications = useCallback(async () => {
    if (!profile?.id) return;
    const db = DatabaseService.getInstance();
    try {
      const [notifs, count] = await Promise.all([
        db.getNotifications(profile.id, { limit: 8 }),
        db.getUnreadNotificationCount(profile.id),
      ]);
      setNotifications(notifs);
      setUnreadCount(count);
    } catch (e) {
      console.warn('[Layout] Failed to load notifications:', e);
    }
  }, [profile?.id]);

  useEffect(() => {
    loadNotifications();
    // Poll every 30 seconds for new notifications + escalation check
    const interval = setInterval(() => {
      loadNotifications();
      NotificationService.checkEscalations().catch(() => { });
    }, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const handleMarkAllRead = async () => {
    if (!profile?.id) return;
    const db = DatabaseService.getInstance();
    await db.markAllNotificationsRead(profile.id);
    await loadNotifications();
  };

  const handleMarkRead = async (id: string) => {
    const db = DatabaseService.getInstance();
    await db.markNotificationRead(id);
    await loadNotifications();
  };

  const handleAcknowledge = async (id: string) => {
    if (!profile?.username) return;
    const db = DatabaseService.getInstance();
    await db.acknowledgeNotification(id, profile.username);
    await loadNotifications();
  };

  // Gap #6: Delete individual notification
  const handleDeleteNotification = async (id: string) => {
    const db = DatabaseService.getInstance();
    await db.deleteNotification(id);
    await loadNotifications();
  };

  // Gap #6: Clear all read notifications
  const handleClearAllRead = async () => {
    const db = DatabaseService.getInstance();
    const readNotifs = notifications.filter(n => n.isRead);
    await Promise.all(readNotifs.map(n => db.deleteNotification(n.id)));
    await loadNotifications();
  };

  // Gap #10: Critical notification banner & sound
  const [criticalBanner, setCriticalBanner] = useState<any | null>(null);
  const prevUnreadRef = React.useRef(unreadCount);

  useEffect(() => {
    // Detect new critical notifications
    if (unreadCount > prevUnreadRef.current) {
      const newCritical = notifications.find(
        n => n.severity === 'CRITICAL' && !n.isRead && !n.isAcknowledged
      );
      if (newCritical) {
        setCriticalBanner(newCritical);
        // Play alert sound
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = 'square';
          gain.gain.value = 0.15;
          osc.start();
          setTimeout(() => { osc.stop(); ctx.close(); }, 300);
        } catch (e) { /* Audio not supported */ }
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⚠️ CRITICAL ALERT', { body: newCritical.title, icon: '/favicon.ico' });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
        // Auto-dismiss banner after 15 seconds
        setTimeout(() => setCriticalBanner(null), 15000);
      }
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount, notifications]);

  const getSeverityIcon = (sev: string) => {
    switch (sev) {
      case 'CRITICAL': return <AlertTriangle className="text-red-500 flex-shrink-0" size={16} />;
      case 'WARNING': return <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />;
      case 'SUCCESS': return <CheckCircle className="text-green-500 flex-shrink-0" size={16} />;
      default: return <Info className="text-blue-500 flex-shrink-0" size={16} />;
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

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 z-20 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-lg md:hidden"
            >
              <Menu size={24} />
            </button>
            <h2 className="text-lg font-semibold text-slate-800 hidden md:block">Maintenance Operations</h2>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setAiOpen(!aiOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${aiOpen
                ? 'bg-blue-50 border-blue-200 text-blue-700 ring-2 ring-blue-100'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
            >
              <Bot size={18} />
              <span className="text-sm font-medium hidden sm:inline">Relantern AI</span>
            </button>

            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>

            {/* ========== NOTIFICATION BELL ========== */}
            <div className="relative">
              <button
                onClick={() => { setNotifOpen(!notifOpen); setUserMenuOpen(false); }}
                className={`p-2 rounded-full relative transition-all ${notifOpen
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full border-2 border-white ${notifications.some(n => n.severity === 'CRITICAL' && !n.isAcknowledged)
                    ? 'bg-red-500 animate-pulse' : 'bg-red-500'
                    }`}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-96 max-h-[520px] bg-white border border-slate-200 rounded-xl shadow-2xl z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                      <div className="flex items-center gap-2">
                        <Bell size={16} className="text-slate-600" />
                        <span className="font-bold text-sm text-slate-800">Notifications</span>
                        {unreadCount > 0 && (
                          <span className="bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                            {unreadCount} new
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
                        >
                          <CheckSquare size={12} /> Mark all read
                        </button>
                      )}
                      {notifications.some(n => n.isRead) && (
                        <button
                          onClick={handleClearAllRead}
                          className="text-xs text-slate-400 hover:text-red-500 font-medium flex items-center gap-1 ml-2"
                          title="Clear all read notifications"
                        >
                          <Trash2 size={12} /> Clear read
                        </button>
                      )}
                    </div>

                    {/* Notification List */}
                    <div className="overflow-y-auto flex-1">
                      {notifications.length === 0 ? (
                        <div className="text-center py-10 text-slate-400">
                          <Bell size={32} className="mx-auto mb-2 opacity-20" />
                          <p className="text-sm">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${!n.isRead ? 'border-l-3 border-l-blue-500 bg-blue-50/30' : ''}`}
                            onClick={() => {
                              handleMarkRead(n.id);
                              if (n.actionLink) {
                                setNotifOpen(false);
                                navigate(n.actionLink);
                              }
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5">{getSeverityIcon(n.severity)}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start gap-2">
                                  <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                                    {n.title}
                                  </p>
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap mt-0.5">{timeAgo(n.createdAt)}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  {n.entityNumber && (
                                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">{n.entityNumber}</span>
                                  )}
                                  {n.actionRequired && !n.isAcknowledged && (
                                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Action Required</span>
                                  )}
                                  {n.severity === 'CRITICAL' && !n.isAcknowledged && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleAcknowledge(n.id); }}
                                      className="text-[10px] font-bold text-white bg-red-500 hover:bg-red-600 px-2 py-0.5 rounded animate-pulse"
                                    >
                                      Acknowledge
                                    </button>
                                  )}
                                  {/* Gap #6: Delete button */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteNotification(n.id); }}
                                    className="text-[10px] text-slate-300 hover:text-red-500 ml-auto transition-colors"
                                    title="Dismiss notification"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Footer */}
                    <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50">
                      <Link
                        to="/notifications"
                        onClick={() => setNotifOpen(false)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1"
                      >
                        View all notifications <ExternalLink size={12} />
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => { setUserMenuOpen(!userMenuOpen); setNotifOpen(false); }}
                className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-slate-100 transition"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs border border-blue-200">
                  {profile?.username?.substring(0, 2).toUpperCase() || 'U'}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-sm font-medium text-slate-700 leading-tight">{profile?.username || 'User'}</div>
                  <div className="text-xs text-slate-400">{role || 'Guest'}</div>
                </div>
                <ChevronDown size={14} className="text-slate-400 hidden sm:block" />
              </button>

              {/* Dropdown Menu */}
              {userMenuOpen && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setUserMenuOpen(false)}
                  />

                  {/* Menu */}
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="p-3 border-b border-slate-100 bg-slate-50">
                      <div className="font-medium text-slate-900">{profile?.username}</div>
                      <div className="text-xs text-slate-500">{role || 'No Role Assigned'}</div>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <LogOut size={16} />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <PullToRefreshWrapper
          onRefresh={async () => {
            await queryClient.invalidateQueries();
            await loadNotifications();
          }}
          className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 pb-20 md:pb-8 scroll-smooth"
        >
          {/* Gap #10: Critical Alert Banner */}
          {criticalBanner && (
            <div className="mb-4 bg-red-600 text-white rounded-xl p-4 flex items-center gap-3 shadow-lg animate-pulse">
              <AlertTriangle size={24} className="flex-shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-sm">⚠️ CRITICAL ALERT</p>
                <p className="text-sm opacity-90">{criticalBanner.title}</p>
                <p className="text-xs opacity-75 mt-0.5">{criticalBanner.message}</p>
              </div>
              <button
                onClick={() => {
                  handleAcknowledge(criticalBanner.id);
                  setCriticalBanner(null);
                }}
                className="bg-white text-red-600 font-bold text-xs px-3 py-1.5 rounded-lg hover:bg-red-50 flex-shrink-0"
              >
                Acknowledge
              </button>
              <button
                onClick={() => setCriticalBanner(null)}
                className="text-white/60 hover:text-white flex-shrink-0"
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </PullToRefreshWrapper>

        {/* AI Overlay */}
        <RelanternAI
          isOpen={aiOpen}
          onClose={() => { setAiOpen(false); setNexusContext(undefined); }}
          contextData={nexusContext}
        />
        <PwaReloadPrompt />
        <BottomNav onOpenSidebar={() => setSidebarOpen(true)} unreadCount={unreadCount} />
        <NetworkStatusBanner />
      </div >
    </div >
  );
};
