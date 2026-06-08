// ═══════════════════════════════════════════════════════════════════════
//  Planning & Scheduling Types — EAM Standards
// ═══════════════════════════════════════════════════════════════════════

export type MaintenanceStrategy = 'Time-Based (PM)' | 'Condition-Based (PdM)' | 'Run-to-Failure (RTF)' | 'Statutory (Compliance)';
export type PlanComplianceStatus = 'compliant' | 'due_soon' | 'overdue';
export type ScheduleEntryStatus = 'scheduled' | 'in_progress' | 'deferred' | 'completed';

/** 
 * Maintenance Plan (aka PM Routine / Maintenance Item) 
 * Defines the recurring strategy for an asset.
 */
export interface MaintenancePlan {
    id: string;
    plan_number: string;
    title: string;
    asset_id: string; // The asset this applies to

    strategy: MaintenanceStrategy;
    frequency_days: number; // e.g., 30 for monthly, 365 for annual

    // Requirements
    required_craft: string;
    estimated_hours: number;

    // Status tracking
    last_completed_date: string | null;
    next_due_date: string;
    compliance_status: PlanComplianceStatus;

    is_active: boolean;
}

/** 
 * Weekly Schedule Entry 
 * Represents a WO or Plan that has been slotted into the calendar.
 */
export interface ScheduleEntry {
    id: string;
    reference_id: string; // Could be a WO ID or a Plan ID
    title: string;
    asset_id: string;

    planned_date: string;
    assigned_crew: string | null;
    required_craft: string;
    estimated_hours: number;

    status: ScheduleEntryStatus;
    deferral_reason?: string;
}

/** 
 * Backlog Item 
 * A Work Order sitting in the queue waiting to be scheduled.
 */
export interface BacklogItem {
    id: string;
    wo_number: string;
    title: string;
    asset_id: string;
    priority: 'routine' | 'urgent' | 'emergency';

    estimated_hours: number;
    required_craft: string;

    // Has parts/materials? Is isolated?
    ready_to_schedule: boolean;
    days_in_backlog: number;
}

/** Planning KPIs Summary */
export interface PlanningSummary {
    pm_compliance_pct: number;
    backlog_weeks: number;
    planned_vs_reactive_ratio: number; // e.g. 80 (meaning 80/20)
    schedule_adherence_pct: number;
    deferred_pms: number;
}
