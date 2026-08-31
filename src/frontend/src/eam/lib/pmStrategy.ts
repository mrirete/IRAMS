/**
 * PM (recurring_work) builder — single source of truth for the maintenance-plan
 * insert shape. Two hand-rolled PM payloads shipped without the NOT-NULL `title`
 * (and risked a null asset_id), so every duplicate/import 400'd at runtime. This
 * builder requires title + assetId at the type level and maps to the canonical
 * NOT-NULL columns (schedule_type / frequency_interval / frequency_unit /
 * job_type), so the gap can't recur.
 *
 * Column names verified against the live recurring_work table.
 */

export interface PMStrategyInput {
    title: string;                 // NOT NULL
    assetId: string;               // NOT NULL (FK)
    frequencyInterval: number;
    frequencyUnit: string;         // Months / Weeks / Hours / …
    description?: string;          // defaults to title
    scheduleType?: string;         // TIME / READING (defaults TIME)
    jobType?: string;              // defaults PM
    priorityCode?: string;         // defaults MEDIUM
    workCenterId?: string | null;  // → work_center_id (0178)
    leadTimeDays?: number;
    estDuration?: number;
    estDowntime?: number;
    createdBy?: string | null;
    code?: string;                 // else generated
    status?: string;               // defaults ACTIVE
    nextDueDate?: string;
    assignedAssets?: unknown[];
    templates?: unknown;
    strategyId?: string;           // 0292: strategy this PM implements
    strategyPackage?: string;      // 0292: which package (label) — drives absorption
    /** 0299: structured provenance — why this PM exists (e.g. {source:'weibull_analysis',
     *  beta, eta_hours, r2, ...}). Display/audit only; generation never reads it. */
    origin?: Record<string, unknown>;
}

function generatePmCode(): string {
    return `PM-${Math.floor(10000 + Math.random() * 90000)}`;
}

// 0305 cadence contract (mirrored by the recurring_work DB constraint
// chk_time_pm_calendar_unit): a TIME schedule needs a unit the calendar
// Autopilot (0304) can serve; running-meter cadences belong to READING
// schedules. The Weibull modal once wrote TIME + 'Hours' and the schedule
// froze forever — this throws a readable error before the DB says no.
const CALENDAR_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'];

/** Build a recurring_work row from a typed input — required fields guaranteed. */
export function buildPMStrategy(i: PMStrategyInput): Record<string, unknown> {
    const scheduleType = (i.scheduleType || 'TIME').toUpperCase();
    if (scheduleType === 'TIME' && !CALENDAR_UNITS.includes(String(i.frequencyUnit || '').toUpperCase())) {
        throw new Error(
            `A time-based PM needs a calendar frequency unit (Days/Weeks/Months/Years) — got "${i.frequencyUnit}". ` +
            `For a running-meter cadence, use scheduleType 'READING' with the meter unit instead.`
        );
    }
    const row: Record<string, unknown> = {
        id: self.crypto.randomUUID(),
        code: i.code || generatePmCode(),
        title: i.title,                         // NOT NULL — enforced by the type
        description: i.description ?? i.title,
        status: i.status || 'ACTIVE',
        asset_id: i.assetId,                    // NOT NULL — enforced by the type
        schedule_type: i.scheduleType || 'TIME',
        frequency_interval: i.frequencyInterval,
        frequency_unit: i.frequencyUnit,
        job_type: i.jobType || 'PM',
        priority_code: i.priorityCode || 'MEDIUM',
        lead_time_days: i.leadTimeDays ?? 7,
        est_duration: i.estDuration ?? 0,
        est_downtime: i.estDowntime ?? 0,
        active: true,
    };
    if (i.workCenterId !== undefined) row.work_center_id = i.workCenterId || null;
    if (i.createdBy !== undefined) row.created_by = i.createdBy || null;
    if (i.nextDueDate) row.next_due_date = i.nextDueDate;
    if (i.assignedAssets !== undefined) row.assigned_assets = i.assignedAssets;
    if (i.templates !== undefined) row.templates = i.templates;
    if (i.strategyId) { row.strategy_id = i.strategyId; row.strategy_package = i.strategyPackage || null; }
    if (i.origin) row.origin = i.origin;
    return row;
}
