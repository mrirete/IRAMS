/**
 * notificationTarget — resolve a notification to ITS SUBJECT, not a module
 * landing page. "PM Overdue — WO 2026-445871" should land on that work order
 * (the LinkedIn rule: tap → the thing itself). Only routes with a verified
 * deep-link contract are mapped; everything else falls back to the row's
 * stored action_link, then the notifications page.
 */
export interface NotificationLinkFields {
    entity_type?: string | null;
    entity_id?: string | null;
    action_link?: string | null;
}

export function notificationTarget(n: NotificationLinkFields): string {
    const id = n.entity_id || '';
    if (id) {
        switch ((n.entity_type || '').toUpperCase()) {
            case 'WORK_ORDER':
            case 'PERMIT_TO_WORK':
                return `/work-orders/${id}`;
            case 'ASSET':
                return `/assets?id=${id}`;
            case 'DE_TASK':
                return `/analyze?division=defect_elimination&task=${id}`;
        }
    }
    return n.action_link || '/notifications';
}
