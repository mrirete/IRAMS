import { useSyncExternalStore } from 'react';
import { offlineQueue } from '../services/offlineQueue';

/**
 * useOfflineQueue — reactive view of the durable write queue + connectivity.
 * Re-renders when the pending count changes or the browser goes on/offline.
 */
export function useOfflineQueue() {
    const pendingCount = useSyncExternalStore(
        (cb) => {
            const unsub = offlineQueue.subscribe(cb);
            window.addEventListener('online', cb);
            window.addEventListener('offline', cb);
            return () => { unsub(); window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
        },
        () => offlineQueue.pendingCount(),
        () => offlineQueue.pendingCount(),
    );

    const isOnline = useSyncExternalStore(
        (cb) => {
            window.addEventListener('online', cb);
            window.addEventListener('offline', cb);
            return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
        },
        () => offlineQueue.isOnline(),
        () => true,
    );

    return { pendingCount, isOnline, flush: offlineQueue.flush };
}
