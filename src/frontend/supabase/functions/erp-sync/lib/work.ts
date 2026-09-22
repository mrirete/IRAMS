/**
 * Work over the live link: notifications out, orders and their status in.
 *
 * A service request in IREAMS is a maintenance notification in SAP (M2 when
 * it reports a breakdown, M1 otherwise), hung on the asset's technical
 * object. An order SAP raises — from that notification or on its own —
 * arrives as an IREAMS work order on the mapped asset, linked to the request
 * it came from, and its SAP status moves the IREAMS status through the same
 * buckets woState.ts defines (open / done / void), so "TECO there closes it
 * here". Phase 2 carries orders one way; IREAMS-raised orders reach SAP in a
 * later phase.
 *
 * Pure. The worker (erp-sync) carries a byte-identical copy; see odata.ts.
 */
import type { ParentRef } from './masterData.ts';

// ── Notifications ────────────────────────────────────────────────────────────

export interface LinkRequest {
    id: string;
    request_number: string;
    status: string;
    description: string;
    asset_id: string;
    requester_id: string | null;
    risk_score: number | null;
    is_breakdown: boolean | null;
    category: string | null;
    created_at: string;
    updated_at: string;
}

export interface NotificationDoc {
    MaintenanceNotification?: string;
    NotificationText: string;            // 40 characters in SAP
    NotificationType: 'M1' | 'M2';       // M1 maintenance request, M2 malfunction report
    TechnicalObject?: string;
    TechObjIsEquipOrFuncnlLoc?: 'EAMS_EQUI' | 'EAMS_FL';
    MaintPriority?: '1' | '2' | '3' | '4';
    ReportedByUser?: string;
    MalfunctionStartDateTime?: string;
    NotificationLongText?: string;
    LastChangeDateTime?: string;
}

export const NOTIFICATION_TEXT_MAX = 40;

/** Requests that are being worked, or already became work, are in SAP's interest; rejected and failed ones are not. */
export const requestGoesOut = (r: Pick<LinkRequest, 'status'>): boolean =>
    ['NEW', 'REVIEW', 'AUTHORIZED', 'APPROVED', 'CONVERTED'].includes(String(r.status ?? '').toUpperCase());

/** SAP's priority 1 (very high) … 4 (low), from the request's risk score and breakdown flag. */
export function priorityFromRisk(risk: number | null | undefined, breakdown: boolean | null | undefined): NotificationDoc['MaintPriority'] {
    if (breakdown) return '1';
    if (typeof risk !== 'number' || !Number.isFinite(risk)) return '3';
    return risk >= 15 ? '1' : risk >= 10 ? '2' : risk >= 5 ? '3' : '4';
}

export const techObjKind = (type: ParentRef['type']): NonNullable<NotificationDoc['TechObjIsEquipOrFuncnlLoc']> =>
    type === 'EQUI' ? 'EAMS_EQUI' : 'EAMS_FL';

export function toNotificationDoc(r: LinkRequest, externalKey: string | null, object: ParentRef | null, reportedBy: string | null): NotificationDoc {
    const text = (r.description || r.request_number).trim();
    const doc: NotificationDoc = {
        NotificationText: text.slice(0, NOTIFICATION_TEXT_MAX),
        NotificationType: r.is_breakdown ? 'M2' : 'M1',
        MaintPriority: priorityFromRisk(r.risk_score, r.is_breakdown),
    };
    if (externalKey) doc.MaintenanceNotification = externalKey;
    if (object) { doc.TechnicalObject = object.key; doc.TechObjIsEquipOrFuncnlLoc = techObjKind(object.type); }
    if (text.length > NOTIFICATION_TEXT_MAX) doc.NotificationLongText = text;
    if (reportedBy) doc.ReportedByUser = reportedBy.slice(0, 12);
    if (r.is_breakdown) doc.MalfunctionStartDateTime = r.created_at;
    return doc;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface OrderDoc {
    MaintenanceOrder: string;
    MaintenanceOrderDesc?: string;
    MaintenanceOrderType?: string;      // PM01 corrective, PM02 preventive, PM03 breakdown — the usual, not universal
    MaintenanceOrderStatus?: string;    // CRTD, REL, PCNF, CNF, TECO, CLSD, DLFL
    TechnicalObject?: string;
    TechObjIsEquipOrFuncnlLoc?: 'EAMS_EQUI' | 'EAMS_FL';
    MaintenanceNotification?: string;
    MaintPriority?: string;
    BasicStartDate?: string;
    BasicEndDate?: string;
    MainWorkCenter?: string;
    LastChangeDateTime?: string;
}

/** IREAMS's native statuses, from SAP's system status. Unknown reads as open — never as done. */
export function woStatusFromSap(status: string | null | undefined): 'OPEN' | 'SCHED' | 'WIP' | 'TECO' | 'CLOSED' | 'CANCELLED' {
    const s = String(status ?? '').trim().toUpperCase();
    if (s === 'CRTD' || s === '') return 'OPEN';
    if (s === 'REL') return 'SCHED';
    if (s === 'PCNF' || s === 'CNF') return 'WIP';
    if (s === 'TECO') return 'TECO';
    if (s === 'CLSD') return 'CLOSED';
    if (s === 'DLFL' || s === 'DLT' || s === 'CNCL') return 'CANCELLED';
    return 'OPEN';
}

/** The register's work types from SAP's order type: preventive, breakdown, else corrective. */
export function woTypeFromSap(orderType: string | null | undefined): 'CM' | 'PM' | 'BM' {
    const t = String(orderType ?? '').trim().toUpperCase();
    if (t === 'PM02') return 'PM';
    if (t === 'PM03') return 'BM';
    return 'CM';
}

export function priorityFromSap(p: string | null | undefined): 'P1' | 'P2' | 'P3' | 'P4' {
    const n = String(p ?? '').trim();
    return n === '1' ? 'P1' : n === '2' ? 'P2' : n === '4' ? 'P4' : 'P3';
}

/** The technical object an order or notification names, as a map lookup. */
export function objectRefOf(e: { TechnicalObject?: string; TechObjIsEquipOrFuncnlLoc?: string }): ParentRef | null {
    const key = (e.TechnicalObject ?? '').trim();
    if (!key) return null;
    return { type: e.TechObjIsEquipOrFuncnlLoc === 'EAMS_FL' ? 'IFLOT' : 'EQUI', key };
}

const dateOnly = (s: string | null | undefined): string | null => /^\d{4}-\d{2}-\d{2}/.exec(s ?? '')?.[0] ?? null;

export interface NewWorkOrder {
    wo_number: string;
    title: string;
    description: string;
    type: 'CM' | 'PM' | 'BM';
    status: ReturnType<typeof woStatusFromSap>;
    asset_id: string;
    priority_code: ReturnType<typeof priorityFromSap>;
    request_id?: string;
    due_date?: string;
    date_due_start?: string;
    properties: { source: 'sap_pm'; sap_order: string; sap_status: string | null; sap_order_type: string | null; sap_work_center: string | null };
}

export const WO_TITLE_MAX = 80;

export function newWorkOrderFromOrder(e: OrderDoc, woNumber: string, assetId: string, requestId: string | null): NewWorkOrder {
    const title = ((e.MaintenanceOrderDesc ?? '').trim() || `SAP order ${e.MaintenanceOrder}`).slice(0, WO_TITLE_MAX);
    const row: NewWorkOrder = {
        wo_number: woNumber,
        title,
        description: (e.MaintenanceOrderDesc ?? '').trim() || title,
        type: woTypeFromSap(e.MaintenanceOrderType),
        status: woStatusFromSap(e.MaintenanceOrderStatus),
        asset_id: assetId,
        priority_code: priorityFromSap(e.MaintPriority),
        properties: {
            source: 'sap_pm', sap_order: e.MaintenanceOrder, sap_status: e.MaintenanceOrderStatus ?? null,
            sap_order_type: e.MaintenanceOrderType ?? null, sap_work_center: e.MainWorkCenter ?? null,
        },
    };
    if (requestId) row.request_id = requestId;
    const due = dateOnly(e.BasicEndDate); if (due) row.due_date = due;
    const start = dateOnly(e.BasicStartDate); if (start) row.date_due_start = start;
    return row;
}

export type WorkOrderPatch = Partial<Pick<NewWorkOrder, 'title' | 'status' | 'priority_code' | 'due_date' | 'date_due_start'>>;

/** What a changed SAP order means for the IREAMS order. */
export function orderPatch(e: Partial<OrderDoc>): WorkOrderPatch {
    const p: WorkOrderPatch = {};
    if (typeof e.MaintenanceOrderDesc === 'string' && e.MaintenanceOrderDesc.trim()) p.title = e.MaintenanceOrderDesc.trim().slice(0, WO_TITLE_MAX);
    if ('MaintenanceOrderStatus' in e) p.status = woStatusFromSap(e.MaintenanceOrderStatus);
    if ('MaintPriority' in e) p.priority_code = priorityFromSap(e.MaintPriority);
    const due = dateOnly(e.BasicEndDate); if (due) p.due_date = due;
    const start = dateOnly(e.BasicStartDate); if (start) p.date_due_start = start;
    return p;
}

export const WO_SYNCED_FIELDS: (keyof WorkOrderPatch)[] = ['title', 'status', 'priority_code', 'due_date', 'date_due_start'];

/** Only what differs. Status compares case-insensitively — the enum is upper case, imports may not be. */
export function workOrderDiff(current: Record<string, unknown>, patch: WorkOrderPatch): WorkOrderPatch {
    const out: WorkOrderPatch = {};
    for (const k of Object.keys(patch) as (keyof WorkOrderPatch)[]) {
        const a = current[k] ?? null;
        const b = patch[k] ?? null;
        const same = k === 'status' ? String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase() : a === b;
        if (!same) (out as Record<string, unknown>)[k] = b;
    }
    return out;
}
