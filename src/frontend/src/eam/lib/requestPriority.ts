/**
 * One banding of a request's risk score (RPN = criticality × severity) into a
 * priority. Used when the score is computed (lib/serviceRequest) and when a
 * stored row is read back (DataMapper) — the card said MEDIUM while the form
 * and the work order said EMERGENCY until both read this (2026-09-08).
 * Lives on its own so DataMapper and serviceRequest do not import each other.
 */
export const RPN_EMERGENCY_THRESHOLD = 40; // Crit A + breakdown (10×10=100) → EMERGENCY

export type RequestPriority = 'EMERGENCY' | 'HIGH' | 'MEDIUM' | 'LOW';

export function priorityFromRpn(rpn: number | null | undefined): RequestPriority {
    const n = Number(rpn) || 0;
    return n >= RPN_EMERGENCY_THRESHOLD ? 'EMERGENCY' : n >= 25 ? 'HIGH' : n >= 10 ? 'MEDIUM' : 'LOW';
}

/**
 * The score a reviewer's priority change writes. There is no priority column —
 * priority is read from risk_score — so overriding it means moving the score
 * to the floor of the chosen band. The audit trigger on service_requests keeps
 * the original score.
 */
export const RPN_FOR_PRIORITY: Record<RequestPriority, number> = {
    EMERGENCY: RPN_EMERGENCY_THRESHOLD,
    HIGH: 25,
    MEDIUM: 10,
    LOW: 1,
};

/**
 * Response target per priority: how long a request may sit before it is
 * turned into a work order or rejected. Every request used to get raised + 24 h
 * whatever its priority, so a day-old LOW read "Overdue" like an EMERGENCY
 * and the whole board went red (2026-10-01).
 */
export const REQUEST_RESPONSE_HOURS: Record<RequestPriority, number> = {
    EMERGENCY: 4,
    HIGH: 24,
    MEDIUM: 72,
    LOW: 168,
};

export function requestDueAt(priority: RequestPriority, createdAt: string | number | Date): string {
    const start = new Date(createdAt).getTime();
    return new Date(start + REQUEST_RESPONSE_HOURS[priority] * 3600000).toISOString();
}
