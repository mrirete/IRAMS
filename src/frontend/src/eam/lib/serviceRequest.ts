/**
 * Service Request core — single source of truth for creating work requests.
 * ════════════════════════════════════════════════════════════════════════
 * Both the mobile "Report a Problem" sheet and the desktop "New Request" form
 * funnel through these helpers, so priority maths, the request shape, and the
 * submit path can never drift apart again.
 *
 *   computeRequestPriority() → RPN (asset criticality × failure severity)
 *   buildServiceRequest()    → a normalized ServiceRequest (NEW status, SLA, …)
 *   submitServiceRequest()   → persists via the offline queue (createServiceRequest)
 */

import { DataMapper } from '../services/DataMapper';
import { offlineQueue } from '../services/offlineQueue';
import { RequestStatus, type ServiceRequest, type JobFile } from '../types';

export interface PriorityResult {
    rpn: number;
    priority: ServiceRequest['priority'];
}

// Criticality scores per ISO 14224 / RPN convention (default 3 if unknown).
const CRIT_SCORES: Record<string, number> = { A: 10, B: 5, C: 2 };
const RPN_EMERGENCY_THRESHOLD = 40; // Crit A + breakdown (10×10=100) → EMERGENCY

/**
 * RPN auto-escalation: Priority = Asset Criticality × Failure Severity.
 * Severity is inferred from breakdown flag + keywords in the description.
 */
export function computeRequestPriority(
    description: string,
    isBreakdown: boolean,
    criticality?: string,
): PriorityResult {
    const critScore = CRIT_SCORES[criticality || ''] || 3;
    const d = (description || '').toLowerCase();

    let severity = 3; // default: low
    if (isBreakdown) severity = 10;
    else if (/(fire|gas leak|explosion)/.test(d)) severity = 10;
    else if (/(leak|safety|hazard)/.test(d)) severity = 8;
    else if (/(vibrat|overheat|abnormal)/.test(d)) severity = 6;
    else if (/(noise|alarm|grinding)/.test(d)) severity = 5;

    const rpn = critScore * severity;
    const priority: ServiceRequest['priority'] =
        rpn >= RPN_EMERGENCY_THRESHOLD ? 'EMERGENCY' : rpn >= 25 ? 'HIGH' : rpn >= 10 ? 'MEDIUM' : 'LOW';

    return { rpn, priority };
}

export interface BuildRequestInput {
    description: string;
    isBreakdown: boolean;
    criticality?: string;          // from the selected asset, drives RPN
    assetId?: string;
    assetName?: string;
    location?: string;
    category?: string;             // defaults to GENERAL
    functionalFailureType?: string;
    files?: JobFile[];
    requesterId: string;
    requesterName: string;
}

// Time-based request number — avoids the collision risk of Math.random(0..999).
function generateRequestNumber(): string {
    const year = new Date().getFullYear();
    const seq = Date.now().toString().slice(-6);
    return `REQ-${year}-${seq}`;
}

/** Build a normalized ServiceRequest ready for persistence. */
export function buildServiceRequest(input: BuildRequestInput): ServiceRequest {
    const { rpn, priority } = computeRequestPriority(input.description, input.isBreakdown, input.criticality);
    const desc = input.description.trim();

    return {
        id: self.crypto.randomUUID(),
        requestNumber: generateRequestNumber(),
        title: desc.slice(0, 40) + (desc.length > 40 ? '…' : ''),
        description: desc,
        assetId: input.assetId,
        assetName: input.assetName,
        location: input.location,
        status: RequestStatus.NEW,
        priority,
        category: input.category || 'GENERAL',
        requesterId: input.requesterId,
        requesterName: input.requesterName,
        createdAt: new Date().toISOString(),
        // EMERGENCY = 4h SLA, otherwise 24h
        slaDeadline: new Date(Date.now() + (priority === 'EMERGENCY' ? 14400000 : 86400000)).toISOString(),
        aiRiskScore: rpn,
        functionalFailureType: input.functionalFailureType || undefined,
        isBreakdown: input.isBreakdown,
        files: input.files || [],
    };
}

export interface SubmitResult {
    queued: boolean;
    request: ServiceRequest;
}

/**
 * Persist a request through the offline queue: executes immediately when online,
 * otherwise saves locally and replays on reconnect. Same `createServiceRequest`
 * executor the rest of the app registers at startup.
 */
export async function submitServiceRequest(req: ServiceRequest, actorId: string): Promise<SubmitResult> {
    const { queued } = await offlineQueue.run(
        'createServiceRequest',
        { record: DataMapper.toDBRequest(req), actor: actorId },
        `Report ${req.requestNumber}`,
    );
    return { queued, request: req };
}
