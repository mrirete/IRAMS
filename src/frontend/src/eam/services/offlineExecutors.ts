import { offlineQueue } from './offlineQueue';
import { DatabaseService } from './DatabaseService';
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

    // Replay anything left over from a previous (offline) session.
    void offlineQueue.flush();
}
