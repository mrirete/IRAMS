/**
 * Status/priority → tone mappings for Badge/StatusPill/PriorityPill.
 * Kept in a non-component module so Badge.tsx exports only components
 * (keeps React Fast Refresh working).
 */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple';

// wo_status enum: OPEN, PLAN, SCHED, WIP, WAIT, CLOSED, TECO, CANCELLED/CANC
export function statusTone(status?: string | null): Tone {
    switch ((status || '').toUpperCase()) {
        case 'CLOSED':
        case 'TECO':
        case 'COMPLETED':
        case 'APPROVED':
            return 'success';
        case 'WIP':
        case 'IN_PROGRESS':
            return 'info';
        case 'WAIT':
        case 'PENDING':
            return 'warning';
        case 'CANCELLED':
        case 'CANC':
            return 'danger';
        case 'OPEN':
        case 'PLAN':
        case 'SCHED':
        case 'DRAFT':
        default:
            return 'neutral';
    }
}

export function priorityTone(priority?: string | null): Tone {
    switch ((priority || '').toUpperCase()) {
        case 'CRITICAL':
        case 'EMERGENCY':
        case 'URGENT':
            return 'danger';
        case 'HIGH':
            return 'warning';
        case 'MEDIUM':
            return 'info';
        case 'LOW':
        default:
            return 'neutral';
    }
}
