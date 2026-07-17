import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../eam/lib/supabase';
import { DatabaseService } from '../eam/services/DatabaseService';

/**
 * Live unread-notification count for one user.
 *
 * Primary signal is a realtime subscription on the user's own notification
 * rows (publication added in 0200; RLS scopes events to the recipient).
 * Window focus and a slow 2-minute poll back it up for sessions on databases
 * where 0200 isn't applied yet — the old 30s bell poll is retired.
 *
 * `onRowsChanged` fires on every realtime event for the user's rows — use it
 * to refresh visible lists (open bell dropdown, alert feed) without each
 * consumer opening its own channel.
 */
export function useUnreadNotifications(userId: string | undefined, onRowsChanged?: () => void) {
    const [unreadCount, setUnreadCount] = useState(0);

    const onRowsChangedRef = useRef(onRowsChanged);
    onRowsChangedRef.current = onRowsChanged;

    const refresh = useCallback(async () => {
        if (!userId) return;
        try {
            setUnreadCount(await DatabaseService.getInstance().getUnreadNotificationCount(userId));
        } catch (e) {
            console.warn('[useUnreadNotifications] count failed:', e);
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        refresh();

        const channel = supabase
            .channel(`notifications-unread:${userId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
                () => {
                    refresh();
                    onRowsChangedRef.current?.();
                })
            .subscribe();

        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        const fallbackPoll = setInterval(refresh, 120_000);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener('focus', onFocus);
            clearInterval(fallbackPoll);
        };
    }, [userId, refresh]);

    return { unreadCount, setUnreadCount, refresh };
}
