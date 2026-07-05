/**
 * notificationRoute — map a notification to a deep link into its object.
 *
 * The server-stored action_link is module-level (e.g. "/work-orders"), so it
 * doesn't land on the specific record. This derives a record-level route from
 * entityType + entityId, matching each page's deep-link convention:
 *   - Work Orders open by path param (/work-orders/:id)
 *   - Assets / Requests / POs / Inventory / PMs open by ?id= query
 */
export interface NotificationLike {
    entityType?: string | null;
    entityId?: string | null;
    actionLink?: string | null;
    module?: string | null;
}

export function notificationRoute(n: NotificationLike): string | null {
    const id = n.entityId || '';
    const type = (n.entityType || '').toUpperCase();
    if (id) {
        switch (type) {
            case 'WORK_ORDER': return `/work-orders/${id}`;
            case 'WORK_REQUEST':
            case 'SERVICE_REQUEST':
            case 'REQUEST': return `/requests?id=${encodeURIComponent(id)}`;
            case 'ASSET': return `/assets?id=${encodeURIComponent(id)}`;
            case 'PURCHASE_ORDER': return `/purchase-orders?id=${encodeURIComponent(id)}`;
            case 'INVENTORY_ITEM': return `/inventory?id=${encodeURIComponent(id)}`;
            case 'PREVENTIVE_MAINTENANCE': return `/recurring-work?id=${encodeURIComponent(id)}`;
            case 'READING': return `/readings`;
            case 'PERMIT_TO_WORK': return `/work-orders/${id}`;
            default: break;
        }
    }
    // Fall back to the stored module-level link, else the inbox.
    return n.actionLink || null;
}

/** True when a notification is an actionable approval on a work request. */
export function isApprovableRequest(n: { notificationType?: string | null; entityType?: string | null; entityId?: string | null; actionRequired?: boolean; isAcknowledged?: boolean }): boolean {
    const type = (n.entityType || '').toUpperCase();
    const isRequest = type === 'WORK_REQUEST' || type === 'SERVICE_REQUEST' || type === 'REQUEST';
    const nt = (n.notificationType || '').toUpperCase();
    return !!n.entityId && isRequest && !n.isAcknowledged && (nt === 'APPROVAL_REQUIRED' || !!n.actionRequired);
}
