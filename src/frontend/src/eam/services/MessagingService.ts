/**
 * MessagingService — contextual, append-only team messaging (migration 0189).
 *
 * Every work object carries its own thread. Messages are the maintenance
 * record: permanent, searchable, realtime. @mentions fan out into the existing
 * notification pipeline (deep-linked back to the thread). Sends route through
 * the offline queue so field techs in dead zones don't lose messages.
 */
import { supabase } from '../lib/supabase';
import { offlineQueue } from './offlineQueue';

export type ThreadType = 'work_order' | 'service_request' | 'rca' | 'asset' | 'work_center';

export interface Message {
    id: string;
    thread_type: ThreadType;
    thread_id: string;
    sender_id: string;
    sender_name: string | null;
    body: string;
    mentions: string[];
    attachment_url: string | null;
    created_at: string;
}

/** Map a thread to the app route a mention-notification should deep-link to. */
export function threadLink(type: ThreadType, id: string): string {
    switch (type) {
        case 'work_order': return `/work-orders/${id}`;
        case 'service_request': return `/service-requests?id=${id}`;
        case 'rca': return `/analyze/rca/${id}`;
        case 'asset': return `/assets?id=${id}`;
        case 'work_center': return `/admin/work-centers`;
        default: return '/';
    }
}

export class MessagingService {
    private static _i: MessagingService;
    static getInstance() { return (this._i ??= new MessagingService()); }

    async getMessages(threadType: ThreadType, threadId: string, limit = 200): Promise<Message[]> {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('thread_type', threadType)
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .limit(limit);
        if (error) { console.error('[MessagingService] getMessages:', error); return []; }
        return (data || []) as Message[];
    }

    /**
     * Post a message. Client-generates the id so the optimistic row and any
     * offline replay are idempotent (insert is the same row either way).
     * Fans @mentions into notifications AFTER a successful online send.
     */
    async postMessage(input: {
        threadType: ThreadType;
        threadId: string;
        body: string;
        senderId: string;
        senderName?: string | null;
        mentions?: string[];
        threadLabel?: string;      // e.g. "WO-2026-4526" — for the notification text
    }): Promise<{ message: Message; queued: boolean }> {
        const row: Message = {
            id: crypto.randomUUID(),
            thread_type: input.threadType,
            thread_id: input.threadId,
            sender_id: input.senderId,
            sender_name: input.senderName ?? null,
            body: input.body.trim(),
            mentions: input.mentions ?? [],
            attachment_url: null,
            created_at: new Date().toISOString(),
        };

        const { queued } = await offlineQueue.run('postMessage', {
            row,
            senderName: input.senderName ?? 'Someone',
            threadLabel: input.threadLabel ?? '',
        }, `Message on ${input.threadLabel || input.threadType}`);

        return { message: row, queued };
    }

    /** Mark a thread read up to now for the current user. */
    async markRead(userId: string, threadType: ThreadType, threadId: string): Promise<void> {
        const { error } = await supabase.from('thread_reads').upsert({
            user_id: userId, thread_type: threadType, thread_id: threadId,
            last_read_at: new Date().toISOString(),
        }, { onConflict: 'user_id,thread_type,thread_id' });
        if (error) console.warn('[MessagingService] markRead:', error.message);
    }

    /** Unread count for one thread (messages after the user's last-read, not their own). */
    async getUnreadCount(userId: string, threadType: ThreadType, threadId: string): Promise<number> {
        const { data: read } = await supabase
            .from('thread_reads').select('last_read_at')
            .eq('user_id', userId).eq('thread_type', threadType).eq('thread_id', threadId)
            .maybeSingle();
        let q = supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('thread_type', threadType).eq('thread_id', threadId)
            .neq('sender_id', userId);
        if (read?.last_read_at) q = q.gt('created_at', read.last_read_at);
        const { count, error } = await q;
        if (error) { console.warn('[MessagingService] getUnreadCount:', error.message); return 0; }
        return count ?? 0;
    }

    /**
     * Realtime subscription for one thread. Calls onInsert for every new message
     * (including the sender's own echo — the UI dedupes by id).
     */
    subscribe(threadType: ThreadType, threadId: string, onInsert: (m: Message) => void) {
        const channel = supabase
            .channel(`messages:${threadType}:${threadId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'messages',
                filter: `thread_id=eq.${threadId}`,
            }, payload => {
                const m = payload.new as Message;
                if (m.thread_type === threadType) onInsert(m);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }
}

export const messagingService = MessagingService.getInstance();
