/**
 * Canonical notification-event registry — the single source of truth for the
 * event names the app actually emits via NotificationService.checkRules().
 *
 * Every emitter and the rule-editor dropdown (NotificationConfig) read from
 * this list, so a rule can no longer be configured against an event that never
 * fires — the bug class that silently killed the 0053 seeds (LOW_STOCK vs
 * STOCK_LOW), STOCK_ZERO, JOB_ASSIGNED, PM_GENERATED and READING_CRITICAL
 * (before it got an emitter).
 *
 * Adding an event = add it here AND emit it; one without the other is a bug.
 * Status transitions deliberately share one *_STATUS_CHANGE event — target a
 * specific transition with a rule filter (field "status", e.g. REJECTED, TECO).
 */

export interface NotificationEventDef {
    code: string;
    description: string;
}

export const NOTIFICATION_EVENTS: Record<string, NotificationEventDef[]> = {
    requests: [
        { code: 'SR_CREATED', description: 'Work request submitted' },
        { code: 'SR_STATUS_CHANGE', description: 'Request status changed — filter on status (APPROVED / REJECTED / CONVERTED …)' },
    ],
    workOrders: [
        { code: 'WO_CREATED', description: 'Work order created' },
        { code: 'WO_STATUS_CHANGE', description: 'Work order status changed — filter on status (TECO, COMPLETED …)' },
    ],
    pm: [
        { code: 'PM_DUE', description: 'PM approaching or due today (within lead time)' },
        { code: 'PM_OVERDUE', description: 'PM past its due date — entity carries criticality + daysOverdue' },
    ],
    inventory: [
        { code: 'STOCK_LOW', description: 'Stock at or below reorder point' },
        { code: 'STOCK_OUT', description: 'Stock at zero' },
    ],
    purchasing: [
        { code: 'PO_CREATED', description: 'Purchase order created' },
        { code: 'PO_RECEIVED', description: 'Purchase order goods received' },
    ],
    readings: [
        { code: 'READING_ALARM', description: 'Reading breached an alarm band (any level)' },
        { code: 'READING_CRITICAL', description: 'Reading breached a CRITICAL band' },
    ],
};

/** Event options for one module (empty when the module has no emitters yet). */
export const eventsForModule = (module?: string): NotificationEventDef[] =>
    (module && NOTIFICATION_EVENTS[module]) || [];

/** Flat set of every canonical event code — for validation/flagging stale rules. */
export const ALL_EVENT_CODES: Set<string> = new Set(
    Object.values(NOTIFICATION_EVENTS).flat().map(e => e.code),
);
