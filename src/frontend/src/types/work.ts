// ═══════════════════════════════════════════════════════════════════════
//  Work Execution Types — ISO 55000 & EAM Standards
// ═══════════════════════════════════════════════════════════════════════

import type { CriticalityRank } from './assets';

/** Standardized Work Types */
export type WorkType = 'PM' | 'CM' | 'EM' | 'PdM' | 'PROJ' | 'DE';

/** Work Request / Work Order Priorities */
export type WorkPriority = 'routine' | 'urgent' | 'emergency';

/** Work Request Lifecycle Statuses */
export type WorkRequestStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'wo_generated';

/** Work Order Lifecycle Statuses */
export type WorkOrderStatus = 'draft' | 'planning' | 'scheduled' | 'in_progress' | 'on_hold' | 'teco' | 'closed';

/** EAM Cost Snapshot (Immutable when closed) */
export interface WorkCostSnapshot {
    labor: number;
    material: number;
    services: number; // contractors/rentals
    total: number;
}

/** Pre-defined Failure Causes */
export type FailureCause = 'bearing_wear' | 'seal_leak' | 'vibration' | 'overheating' | 'electrical_fault' | 'lubrication' | 'operator_error' | 'other';

/** Mandatory Failure Coding for TECO */
export interface FailureCoding {
    failure_mode: string;
    failure_cause: FailureCause;
    remedy: string;
    downtime_hours: number;
}

/** 
 * Work Request (WR) 
 * Can be raised against any taxonomy level (Site -> Component)
 */
export interface WorkRequest {
    id: string;
    wr_number: string;
    title: string;
    description: string;

    // Assumed user mapping (simple strings for now)
    requester: string;
    created_at: string;

    // Asset link
    asset_id: string;
    taxonomy_level: string; // e.g., 'equipment' | 'system'
    criticality: CriticalityRank;

    // Risk & Priority
    priority: WorkPriority;
    severity_rating: number; // 1-5
    rpn: number; // Criticality (1-5) * Severity (1-5) 

    status: WorkRequestStatus;

    // Gatekeeper Info (If Rejected/Cancelled)
    rejection_reason?: string;
    gatekeeper_signoff?: string;

    // Linked WO
    work_order_id?: string;

    // Linked Inspection (if WR originated from inspection finding)
    inspection_id?: string;
}

/**
 * Work Order (WO)
 * Executable record. Must target Equipment (L6) or lower.
 */
export interface WorkOrder {
    id: string;
    wo_number: string;
    type: WorkType;
    title: string;
    description: string;

    status: WorkOrderStatus;
    priority: WorkPriority;

    // Asset Link - Strict targeting
    asset_id: string; // Must be L6/L7/L8

    // Scheduling
    planned_start_date: string | null;
    planned_finish_date: string | null;
    actual_start_date: string | null;
    actual_finish_date: string | null;

    // Execution
    assigned_crew: string | null;
    lead_craft: string | null;
    estimated_hours: number;
    actual_hours: number;

    // Completion Requirements
    failure_coding: FailureCoding | null;

    // Costs
    costs: WorkCostSnapshot;

    created_at: string;
    updated_at: string;

    // Linked Inspection (if WO supports an inspection event)
    inspection_id?: string;
}

/** Execution KPIs Summary */
export interface ExecutionSummary {
    open_wos: number;
    overdue_wos: number;
    emergency_wos: number;
    avg_mttr_hours: number;
    backlog_hours: number;
    pending_wra: number;
    schedule_compliance_pct: number;
}
