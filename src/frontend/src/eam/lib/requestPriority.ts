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
