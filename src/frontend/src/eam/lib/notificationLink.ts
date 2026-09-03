/**
 * notificationTarget — resolve a notification to ITS SUBJECT, not a module
 * landing page. "PM Overdue — WO 2026-445871" should land on that work order
 * (the LinkedIn rule: tap → the thing itself). Only routes with a verified
 * deep-link contract are mapped; everything else falls back to the row's
 * stored action_link, then the notifications page.
 *
 * Entity-type vocabulary is whatever the emitters write — NotificationService
 * (WORK_ORDER, WORK_REQUEST, DE_TASK, RCA_INVESTIGATION, INVENTORY_ITEM,
 * CONTACT, ASSET…), the SQL rules ('WO', 'REQ', 'ASSET', 'CONTACT') and the
 * watchdog ('budget', 'asset') — so matching is case-insensitive over aliases.
 */
export interface NotificationLinkFields {
    entity_type?: string | null;
    entity_id?: string | null;
    action_link?: string | null;
}

/** Verified deep-link contracts: page reads the id / tab query parameter (or route param). */
const TARGETS: Record<string, (id: string) => string> = {
    WORK_ORDER: (id) => `/work-orders/${id}`,
    WO: (id) => `/work-orders/${id}`,
    PERMIT_TO_WORK: (id) => `/work-orders/${id}`,
    WORK_REQUEST: (id) => `/requests?id=${id}`,          // ServiceRequests reads ?id
    REQ: (id) => `/requests?id=${id}`,
    SERVICE_REQUEST: (id) => `/requests?id=${id}`,
    ASSET: (id) => `/assets?id=${id}`,
    DE_TASK: (id) => `/analyze?division=defect_elimination&task=${id}`,
    RCA_INVESTIGATION: (id) => `/analyze/rca/${id}`,      // route param (App.tsx)
    INVENTORY_ITEM: (id) => `/inventory?id=${id}`,        // Inventory reads ?id
    CONTACT: (id) => `/contacts?id=${id}`,                // Contacts reads ?id
    BUDGET: () => `/finops?tab=dashboard`,                // FinOps has tabs, no per-budget anchor yet
};

export function notificationTarget(n: NotificationLinkFields): string {
    const id = n.entity_id || '';
    if (id) {
        const key = (n.entity_type || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
        const to = TARGETS[key];
        if (to) return to(id);
    }
    return n.action_link || '/notifications';
}
