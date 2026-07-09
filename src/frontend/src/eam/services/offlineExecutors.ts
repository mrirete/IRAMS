import { offlineQueue } from './offlineQueue';
import { DatabaseService } from './DatabaseService';
import { supabase } from '../lib/supabase';
import { threadLink, type Message, type ThreadType } from './MessagingService';
import type { ServiceRequestRecord } from '../schema';

// Derive the updateWorkOrder args from the method itself — no fragile type imports.
type UpdateWorkOrderUpdates = Parameters<DatabaseService['updateWorkOrder']>[1];

/**
 * Registers offline-queue executors for every queueable write. Called once from
 * AppLayout (always mounted) so queued ops can replay after a reload — even if the
 * originating page (e.g. QuickReport) hasn't been opened in the new session.
 *
 * Payload shapes are defined alongside each `register` call and must match what
 * the corresponding `offlineQueue.run(kind, payload)` site sends.
 */

export interface CreateServiceRequestPayload {
    record: ServiceRequestRecord;
    actor: string;
}

export interface SaveWorkOrderPayload {
    id: string;
    updates: UpdateWorkOrderUpdates;
    actor: string;
}

let initialised = false;

export function initOfflineExecutors() {
    if (initialised) return;
    initialised = true;

    offlineQueue.register('createServiceRequest', async (payload) => {
        const { record, actor } = payload as CreateServiceRequestPayload;
        await DatabaseService.getInstance().createRequest(record, actor);
    });

    // Field meter/condition readings — operators often log these with no signal.
    // Payload is the DB log row (client-generated id, so replay is idempotent).
    offlineQueue.register('logReading', async (payload) => {
        await DatabaseService.getInstance().logReading(payload);
    });

    // Work-order save (the everyday "Save"/autosave, NOT TECO completion which needs
    // online validation). updateWorkOrder is a single idempotent op: failure data is
    // upserted by wo_id; tasks/labor/parts are upserted by id + orphans deleted — so
    // replaying the whole payload converges to the same state (ids are normalized at
    // the call site to keep upserts stable across retries).
    offlineQueue.register('saveWorkOrder', async (payload) => {
        const { id, updates, actor } = payload as SaveWorkOrderPayload;
        await DatabaseService.getInstance().updateWorkOrder(id, updates, actor);
    });

    // Contextual message send (thread chat). The row carries a client-generated
    // id, so replaying the insert is idempotent (unique PK). @mentions fan out
    // into notifications AFTER the insert lands — done here (not at the UI) so
    // an offline-queued message still notifies mentioned users on replay.
    offlineQueue.register('postMessage', async (payload) => {
        const { row, senderName, threadLabel } = payload as { row: Message; senderName: string; threadLabel: string };
        const { error } = await supabase.from('messages').insert(row);
        // 23505 = the row already landed (a prior partial success) — treat as done.
        if (error && (error as { code?: string }).code !== '23505') throw error;

        const mentions: string[] = Array.isArray(row.mentions) ? row.mentions : [];
        if (mentions.length === 0) return;
        const db = DatabaseService.getInstance();
        const link = threadLink(row.thread_type as ThreadType, row.thread_id);
        const label = threadLabel || row.thread_type.replace('_', ' ');
        const snippet = row.body.length > 120 ? row.body.slice(0, 117) + '…' : row.body;
        await Promise.all(mentions
            .filter(uid => uid && uid !== row.sender_id)
            .map(uid => db.createNotification({
                recipientId: uid,
                title: `💬 ${senderName} mentioned you on ${label}`,
                message: snippet,
                severity: 'INFO',
                notificationType: 'MENTION',
                module: 'messaging',
                entityId: row.thread_id,
                entityType: row.thread_type.toUpperCase(),
                actionLink: link,
                actionRequired: false,
                createdBy: row.sender_id,
            }).catch(e => console.warn('[postMessage] mention notify failed:', e))));
    });

    // Replay anything left over from a previous (offline) session.
    void offlineQueue.flush();
}
