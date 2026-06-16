/**
 * offlineQueue — durable write queue for field/offline use.
 *
 * When a technician or operator is offline (no signal in a plant), writes are
 * persisted to localStorage and replayed automatically on reconnect, instead of
 * being lost. Replaces the earlier in-memory counter stub.
 *
 * Usage:
 *   // once, at app start (AppLayout) — register how each kind is executed:
 *   offlineQueue.register('createServiceRequest', ({ record, actor }) => db.createRequest(record, actor));
 *
 *   // at a write site — run it through the queue:
 *   const { queued } = await offlineQueue.run('createServiceRequest', { record, actor }, 'Service request');
 *   //  queued === true  → saved locally, will sync later
 *   //  queued === false → executed immediately (online)
 */

const STORAGE_KEY = 'ers_offline_queue_v1';
const MAX_RETRIES = 5;

export interface QueuedOp {
    id: string;
    kind: string;
    payload: unknown;
    label?: string;
    createdAt: number;
    retries: number;
}

type Executor = (payload: unknown) => Promise<void>;

const executors = new Map<string, Executor>();
const listeners = new Set<() => void>();
let flushing = false;

function load(): QueuedOp[] {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        return raw ? (JSON.parse(raw) as QueuedOp[]) : [];
    } catch {
        return [];
    }
}

let queue: QueuedOp[] = load();

function persist() {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch {
        /* storage full / unavailable — keep in-memory copy */
    }
    listeners.forEach(l => l());
}

function isOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}

// Heuristic: did this failure look like a connectivity problem (vs a real validation error)?
function isNetworkError(e: unknown): boolean {
    if (!isOnline()) return true;
    const msg = (e instanceof Error ? e.message : String(e ?? '')).toLowerCase();
    return msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('connection');
}

function enqueue(kind: string, payload: unknown, label?: string) {
    queue.push({ id: crypto.randomUUID(), kind, payload, label, createdAt: Date.now(), retries: 0 });
    persist();
}

export const offlineQueue = {
    /** Register the executor for a kind of operation (idempotent). */
    register(kind: string, exec: Executor) {
        executors.set(kind, exec);
    },

    isOnline,
    pendingCount: () => queue.length,
    pending: () => [...queue],

    /** Subscribe to queue changes (returns an unsubscribe fn). */
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /**
     * Execute now if online & the call succeeds; otherwise persist for later.
     * Non-network errors (e.g. validation) are re-thrown so callers can surface them.
     */
    async run(kind: string, payload: unknown, label?: string): Promise<{ queued: boolean }> {
        const exec = executors.get(kind);
        if (isOnline() && exec) {
            try {
                await exec(payload);
                return { queued: false };
            } catch (e) {
                if (!isNetworkError(e)) throw e; // genuine failure — don't silently queue
            }
        }
        enqueue(kind, payload, label);
        return { queued: true };
    },

    /** Replay queued ops in order. Stops on the first network failure (still offline). */
    async flush(): Promise<void> {
        if (flushing || !isOnline()) return;
        flushing = true;
        try {
            for (const op of [...queue]) {
                const exec = executors.get(op.kind);
                if (!exec) continue; // executor not registered yet — try again next flush
                try {
                    await exec(op.payload);
                    queue = queue.filter(q => q.id !== op.id);
                    persist();
                } catch (e) {
                    if (isNetworkError(e)) break; // went offline mid-flush — keep the rest
                    op.retries += 1;
                    if (op.retries > MAX_RETRIES) queue = queue.filter(q => q.id !== op.id); // give up on a poison op
                    persist();
                }
            }
        } finally {
            flushing = false;
        }
    },
};

// Auto-flush whenever the browser regains connectivity.
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { void offlineQueue.flush(); });
}
