import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WifiOff, Wifi, AlertTriangle, RefreshCw, CloudOff } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * NetworkStatusBanner — Production-grade offline awareness
 * 
 * Detects both browser-level offline (navigator.onLine) and
 * Supabase connectivity issues (failed heartbeat).
 * Shows persistent warning when offline with details about
 * what will/won't work.
 */

interface OfflineQueueItem {
    id: string;
    entity: string;
    operation: string;
    timestamp: number;
}

// Global offline queue (IndexedDB would be Phase 2, in-memory for now)
let pendingQueue: OfflineQueueItem[] = [];

export const addToOfflineQueue = (entity: string, operation: string) => {
    pendingQueue.push({
        id: crypto.randomUUID(),
        entity,
        operation,
        timestamp: Date.now()
    });
};

export const getOfflineQueueSize = () => pendingQueue.length;
export const clearOfflineQueue = () => { pendingQueue = []; };

export const NetworkStatusBanner: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [isSupabaseReachable, setIsSupabaseReachable] = useState(true);
    const [showReconnected, setShowReconnected] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [queueSize, setQueueSize] = useState(0);
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
            setQueueSize(pendingQueue.length);
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
                        bg-red-50 text-red-800 border-b border-red-200 animate-pulse-slow">
            {!isOnline ? (
                <>
                    <WifiOff size={14} className="text-red-500 flex-shrink-0" />
                    <span>
                        <strong>No internet connection</strong> — Changes will NOT save. 
                        Reconnect to avoid data loss.
                    </span>
                </>
            ) : (
                <>
                    <CloudOff size={14} className="text-red-500 flex-shrink-0" />
                    <span>
                        <strong>Database unreachable</strong> — Your internet is on but the database isn't responding.
                        Changes may not save.
                    </span>
                    <button
                        onClick={checkSupabase}
                        disabled={isChecking}
                        className="ml-2 px-2 py-1 bg-red-100 hover:bg-red-200 rounded text-[10px] font-bold 
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
