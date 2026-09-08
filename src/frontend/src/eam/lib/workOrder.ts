/**
 * Work-order builder — single source of truth for the work_orders insert shape.
 * ════════════════════════════════════════════════════════════════════════════
 * Hand-rolled createWorkOrder payloads drifted from the real columns (e.g. a
 * `priority` field instead of priority_code, a phantom `source` column), which
 * only failed at runtime. This builder maps a typed input to the correct DB
 * columns, so a wrong/missing field is a compile error, not a 400 in production.
 *
 * Column names verified against the live work_orders table.
 */

export interface WorkOrderInput {
    title: string;                 // NOT NULL
    assetId: string;               // NOT NULL (FK)
    type: string;                  // CM / PM / PdM / EM …
    description?: string;          // defaults to title
    priorityCode?: string;         // → priority_code (defaults MEDIUM)
    status?: string;               // defaults OPEN
    workCenterId?: string | null;  // → work_center_id (0178)
    parentWoId?: string;
    recurringWorkId?: string;
    requestId?: string;
    costCenterId?: string | null;
    assignedTo?: string | null;
    createdBy?: string | null;
    dueDate?: string;
    dateDueStart?: string;
    estDuration?: number;
    woNumber?: string;             // else generated
    warrantyFlag?: boolean;
    warrantyId?: string | null;
    costFrozen?: boolean;
    frozenLaborCost?: number;
    frozenMaterialCost?: number;
    properties?: Record<string, unknown>;
}

/**
 * Preventive work-order types — the ONE list deciding whether failure coding
 * is required at completion. The client gate (WorkOrders.tsx) and the server
 * gate (DatabaseService TECO validation) previously carried different lists,
 * so a PdM/SCHEDULED WO passed the client and was then rejected server-side.
 */
/**
 * EN 13306 (maintenance terminology) §7: these are the PREVENTIVE family —
 * predetermined (PM/SCHEDULED/CALIBRATION), condition-based (INSPECTION) and
 * predictive (PREDICTIVE/PDM). Everything else is treated as CORRECTIVE
 * (deferred or immediate). The failure predicate in reliabilityMetrics.ts and
 * the SQL view sem_asset_reliability use the same split.
 */
export const PREVENTIVE_WO_TYPES = [
    'PM', 'PREVENTIVE', 'PREVENTATIVE', 'SCHEDULED',
    'INSPECTION', 'PREDICTIVE', 'PDM', 'CALIBRATION',
] as const;

export function isPreventiveWoType(type: string | null | undefined): boolean {
    return (PREVENTIVE_WO_TYPES as readonly string[]).includes(String(type || '').toUpperCase());
}

function generateWoNumber(): string {
    return `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
}

/** Build a work_orders row from a typed input — only valid columns, defaults applied. */
export function buildWorkOrder(i: WorkOrderInput): Record<string, unknown> {
    const row: Record<string, unknown> = {
        wo_number: i.woNumber || generateWoNumber(),
        title: i.title,
        description: i.description ?? i.title,
        type: i.type,
        status: i.status || 'OPEN',
        asset_id: i.assetId,
        priority_code: i.priorityCode || 'MEDIUM',
    };
    // Optional pass-throughs — included only when provided, always the right column.
    if (i.workCenterId !== undefined) row.work_center_id = i.workCenterId || null;
    if (i.parentWoId) row.parent_wo_id = i.parentWoId;
    if (i.recurringWorkId) row.recurring_work_id = i.recurringWorkId;
    if (i.requestId) row.request_id = i.requestId;
    if (i.costCenterId !== undefined) row.cost_center_id = i.costCenterId || null;
    if (i.assignedTo !== undefined) row.assigned_to = i.assignedTo || null;
    if (i.createdBy !== undefined) row.created_by = i.createdBy || null;
    if (i.dueDate) row.due_date = i.dueDate;
    if (i.dateDueStart) row.date_due_start = i.dateDueStart;
    if (i.estDuration !== undefined) row.est_duration = i.estDuration;
    if (i.warrantyFlag !== undefined) row.warranty_flag = i.warrantyFlag;
    if (i.warrantyId !== undefined) row.warranty_id = i.warrantyId;
    if (i.costFrozen !== undefined) row.cost_frozen = i.costFrozen;
    if (i.frozenLaborCost !== undefined) row.frozen_labor_cost = i.frozenLaborCost;
    if (i.frozenMaterialCost !== undefined) row.frozen_material_cost = i.frozenMaterialCost;
    if (i.properties !== undefined) row.properties = i.properties;
    return row;
}

/**
 * Does this work order involve this person? THE one definition, used by
 * My Work, the "Assigned to me" preset and My Work Today.
 *
 * A job is "mine" when I am the order's assignee (work_orders.assigned_to,
 * a contacts.id), OR I am ticked on any of its task steps (job_tasks.
 * assigned_user_ids — the Resources-tab checkbox, which stores users.id),
 * OR I have a labour line on it. Planners assign at the task level far
 * more often than at the order level, so reading only assigned_to left a
 * technician's real work invisible on My Work (WO-2026-01000, 2026-09-08).
 * `ids` should hold every id the person may be recorded under: contact id,
 * user id, and legacy username / email.
 */
export function woInvolvesPerson(
    wo: {
        assignedTo?: string | null;
        tasks?: { assignedUserIds?: string[] | null }[] | null;
        labor?: { contactId?: string | null }[] | null;
    },
    ids: Iterable<string | null | undefined>,
): boolean {
    const mine = new Set<string>();
    for (const id of ids) if (id) mine.add(id);
    if (mine.size === 0) return false;
    if (wo.assignedTo && mine.has(wo.assignedTo)) return true;
    for (const t of wo.tasks || []) {
        for (const uid of t.assignedUserIds || []) if (mine.has(uid)) return true;
    }
    for (const l of wo.labor || []) if (l.contactId && mine.has(l.contactId)) return true;
    return false;
}
