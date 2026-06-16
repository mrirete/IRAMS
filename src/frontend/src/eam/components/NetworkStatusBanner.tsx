import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WifiOff, Wifi, RefreshCw, CloudOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

/**
 * NetworkStatusBanner — Production-grade offline awareness.
 *
 * Detects browser-level offline (navigator.onLine) and Supabase connectivity
 * (failed heartbeat). Because writes now go through the durable offline queue
 * (see services/offlineQueue.ts), the messaging reassures the user that work is
 * saved on-device and synced on reconnect — and shows the pending-sync count.
 */

export const NetworkStatusBanner: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [isSupabaseReachable, setIsSupabaseReachable] = useState(true);
    const [showReconnected, setShowReconnected] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const { pendingCount: queueSize } = useOfflineQueue();
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Check Supabase connectivity
    const checkSupabase = useCallback(async () => {
        if (!navigator.onLine) return;
        try {
            setIsChecking(true);
            const { error } = await supabase.from('reference_codes').select('id').limit(1);
            setIsSupabaseReachable(!error);
        } catch {
            setIsSupabaseReachable(false);
        } finally {
            setIsChecking(false);
        }
    }, []);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setShowReconnected(true);
            // Check Supabase when browser comes back online
            checkSupabase();
            reconnectTimerRef.current = setTimeout(() => setShowReconnected(false), 4000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setIsSupabaseReachable(false);
            setShowReconnected(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Heartbeat: check Supabase every 60s when online
        heartbeatRef.current = setInterval(() => {
            if (navigator.onLine) {
                checkSupabase();
            }
        }, 60_000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        };
    }, [checkSupabase]);

    const effectivelyOffline = !isOnline || !isSupabaseReachable;

    // Nothing to show if everything is fine
    if (!effectivelyOffline && !showReconnected) return null;

    // ── Reconnected banner (auto-dismiss after 4s) ──
    if (showReconnected && !effectivelyOffline) {
        return (
            <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold
                            bg-emerald-50 text-emerald-700 border-b border-emerald-200
                            animate-in slide-in-from-top transition-all duration-300">
                <Wifi size={14} className="text-emerald-500" />
                <span>Connection restored — all changes will save normally</span>
                {queueSize > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-emerald-100 rounded-full text-[10px] font-bold">
                        {queueSize} queued {queueSize === 1 ? 'change' : 'changes'} syncing...
                    </span>
                )}
            </div>
        );
    }

    // ── Offline / Supabase unreachable banner ──
    return (
        <div className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold
                        bg-amber-50 text-amber-800 border-b border-amber-200">
            {!isOnline ? (
                <>
                    <WifiOff size={14} className="text-amber-500 flex-shrink-0" />
                    <span>
                        <strong>Working offline</strong> — your changes are saved on this device and will sync automatically when you reconnect.
                    </span>
                    {queueSize > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-amber-100 rounded-full text-[10px] font-bold">
                            {queueSize} waiting to sync
                        </span>
                    )}
                </>
            ) : (
                <>
                    <CloudOff size={14} className="text-amber-500 flex-shrink-0" />
                    <span>
                        <strong>Reconnecting…</strong> — your internet is on but the database isn't responding yet. Changes are queued and will save shortly.
                    </span>
                    {queueSize > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-amber-100 rounded-full text-[10px] font-bold">
                            {queueSize} queued
                        </span>
                    )}
                    <button
                        onClick={checkSupabase}
                        disabled={isChecking}
                        className="ml-2 px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded text-[10px] font-bold
                                   flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={10} className={isChecking ? 'animate-spin' : ''} />
                        Retry
                    </button>
                </>
            )}
        </div>
    );
};
