import { useState, useMemo, useCallback } from 'react';
import type { WorkRequest, WorkOrder, ExecutionSummary, WorkOrderStatus, WorkType, WorkPriority } from '../types/work';
import { MOCK_ASSETS } from './useIntelligence';

// ═══════════════════════════════════════════════════════════════════════
//  MOCK DATA — Work Execution
// ═══════════════════════════════════════════════════════════════════════

const d = (daysOff: number) => new Date(Date.now() + daysOff * 86400000).toISOString();

// Pre-defined Work Orders
const MOCK_WOS: WorkOrder[] = [
    {
        id: 'wo-101',
        wo_number: 'WO-2024-1001',
        type: 'PM',
        title: 'Quarterly Maintenance - Gas Compressor',
        description: 'Perform standard quarterly PM (vibration check, oil sample, filter replacement).',
        status: 'in_progress',
        priority: 'routine',
        asset_id: 'ast-k601',
        planned_start_date: d(-2),
        planned_finish_date: d(1),
        actual_start_date: d(-1),
        actual_finish_date: null,
        assigned_crew: 'Mech-Crew-A',
        lead_craft: 'Mechanic',
        estimated_hours: 12,
        actual_hours: 8,
        failure_coding: null,
        costs: { labor: 600, material: 250, services: 0, total: 850 },
        created_at: d(-15),
        updated_at: d(-1)
    },
    {
        id: 'wo-102',
        wo_number: 'WO-2024-1002',
        type: 'CM',
        title: 'Replace High Vibration Bearing',
        description: 'Vibration alert triggered. Immediate replacement of DE bearing required.',
        status: 'planning',
        priority: 'urgent',
        asset_id: 'ast-k601',
        planned_start_date: d(1),
        planned_finish_date: d(3),
        actual_start_date: null,
        actual_finish_date: null,
        assigned_crew: 'Mech-Crew-B',
        lead_craft: 'Millwright',
        estimated_hours: 24,
        actual_hours: 0,
        failure_coding: null,
        costs: { labor: 0, material: 0, services: 0, total: 0 },
        created_at: d(-2),
        updated_at: d(0)
    },
    {
        id: 'wo-103',
        wo_number: 'WO-2024-1003',
        type: 'EM',
        title: 'Seal Failure - Emergency Repair',
        description: 'Catastrophic failure of primary seal. Asset shut down.',
        status: 'teco',
        priority: 'emergency',
        asset_id: 'ast-k601', // Should really be 'ast-k601-seal' but for simplicity
        planned_start_date: d(-5),
        planned_finish_date: d(-4),
        actual_start_date: d(-5),
        actual_finish_date: d(-4),
        assigned_crew: 'Emergency-Response-1',
        lead_craft: 'Mechanic',
        estimated_hours: 8,
        actual_hours: 14,
        failure_coding: {
            failure_mode: 'Mechanical Seal Blowout',
            failure_cause: 'seal_leak',
            remedy: 'Replaced complete seal assembly',
            downtime_hours: 18
        },
        costs: { labor: 2100, material: 8500, services: 1200, total: 11800 },
        created_at: d(-6),
        updated_at: d(-4)
    },
    {
        id: 'wo-104',
        wo_number: 'WO-2024-1004',
        type: 'PdM',
        title: 'Laser Alignment Check',
        description: 'Perform laser alignment on motor/pump coupling based on IR scan.',
        status: 'scheduled',
        priority: 'routine',
        asset_id: 'ast-p102',
        planned_start_date: d(5),
        planned_finish_date: d(5),
        actual_start_date: null,
        actual_finish_date: null,
        assigned_crew: 'Reliability-Team',
        lead_craft: 'Technician',
        estimated_hours: 4,
        actual_hours: 0,
        failure_coding: null,
        costs: { labor: 0, material: 0, services: 0, total: 0 },
        created_at: d(-10),
        updated_at: d(-1)
    },
    {
        id: 'wo-105',
        wo_number: 'WO-2024-1005',
        type: 'PM',
        title: 'Annual Turbine Inspection',
        description: 'Comprehensive borescope inspection of hot gas path.',
        status: 'on_hold',
        priority: 'routine',
        asset_id: 'ast-gt301',
        planned_start_date: d(-1),
        planned_finish_date: d(14),
        actual_start_date: null,
        actual_finish_date: null,
        assigned_crew: null,
        lead_craft: 'Specialist',
        estimated_hours: 120,
        actual_hours: 0,
        failure_coding: null,
        costs: { labor: 0, material: 0, services: 0, total: 0 },
        created_at: d(-30),
        updated_at: d(-2)
    }
];

// Pre-defined Work Requests
const MOCK_WRS: WorkRequest[] = [
    {
        id: 'wr-201',
        wr_number: 'WR-2024-0891',
        title: 'High vibration on DE bearing',
        description: 'Noticed excessive vibration on the drive end bearing during walkaround.',
        requester: 'J. Smith (Operator)',
        created_at: d(-1),
        asset_id: 'ast-k601',
        taxonomy_level: 'equipment',
        criticality: 'A',
        priority: 'urgent',
        severity_rating: 4,
        rpn: 20, // 5 (Crit A) * 4
        status: 'approved',
        work_order_id: 'wo-102'
    },
    {
        id: 'wr-202',
        wr_number: 'WR-2024-0890',
        title: 'Abnormal noise during startup',
        description: 'Loud grinding noise heard during pump startup sequence.',
        requester: 'M. Johnson (Operator)',
        created_at: d(0),
        asset_id: 'ast-p102',
        taxonomy_level: 'equipment',
        criticality: 'B',
        priority: 'routine',
        severity_rating: 3,
        rpn: 9, // 3 (Crit B) * 3
        status: 'pending_review'
    },
    {
        id: 'wr-203',
        wr_number: 'WR-2024-0885',
        title: 'Small oil leak near skid base',
        description: 'Minor oil dripping observed. Approximately 1 drop per minute.',
        requester: 'A. Davis (Operator)',
        created_at: d(-3),
        asset_id: 'ast-gt301',
        taxonomy_level: 'system',
        criticality: 'A',
        priority: 'routine',
        severity_rating: 1,
        rpn: 5, // 5 (Crit A) * 1
        status: 'draft'
    }
];

// ═══════════════════════════════════════════════════════════════════════
//  COMPUTED SUMMARIES
// ═══════════════════════════════════════════════════════════════════════

function computeSummary(wos: WorkOrder[], wrs: WorkRequest[]): ExecutionSummary {
    const activeStatus: WorkOrderStatus[] = ['planning', 'scheduled', 'in_progress', 'on_hold'];
    const activeWOs = wos.filter(w => activeStatus.includes(w.status));

    const nowMs = Date.now();
    const overdueWOs = activeWOs.filter(w => w.planned_finish_date && new Date(w.planned_finish_date).getTime() < nowMs);

    return {
        open_wos: activeWOs.length,
        overdue_wos: overdueWOs.length,
        emergency_wos: wos.filter(w => w.type === 'EM').length,
        avg_mttr_hours: 14.5, // Mock calculated
        backlog_hours: activeWOs.reduce((sum, w) => sum + w.estimated_hours, 0),
        pending_wra: wrs.filter(w => w.status === 'pending_review').length,
        schedule_compliance_pct: 82.5,
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  STATUS WORKFLOW GATES (ISO 55000)
// ═══════════════════════════════════════════════════════════════════════

const WO_STATUS_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
    draft: ['planning'],
    planning: ['scheduled', 'draft'],
    scheduled: ['in_progress', 'on_hold', 'planning'],
    in_progress: ['teco', 'on_hold'],
    on_hold: ['in_progress', 'scheduled'],
    teco: ['closed'],
    closed: [], // terminal — no transitions
};

// ═══════════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════

export interface AuditEntry {
    id: string;
    timestamp: string;
    user: string;
    action: 'create' | 'update' | 'delete' | 'status_change';
    entity_type: 'wo' | 'wr';
    entity_id: string;
    field?: string;
    old_value?: string;
    new_value?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════

export interface WorkFilters {
    search: string;
    type: WorkType | 'all';
    status: WorkOrderStatus | 'all';
    priority: WorkPriority | 'all';
}

const DEFAULT_FILTERS: WorkFilters = {
    search: '', type: 'all', status: 'all', priority: 'all'
};

export function useWork() {
    const [wos, setWos] = useState<WorkOrder[]>(MOCK_WOS);
    const [wrs, setWrs] = useState<WorkRequest[]>(MOCK_WRS);
    const [filters, setFilters] = useState<WorkFilters>(DEFAULT_FILTERS);
    const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

    const summary = useMemo(() => computeSummary(wos, wrs), [wos, wrs]);

    const filteredWOs = useMemo(() => {
        let list = [...wos];
        const { search, type, status, priority } = filters;

        if (search) {
            const q = search.toLowerCase();
            list = list.filter(w => w.wo_number.toLowerCase().includes(q) || w.title.toLowerCase().includes(q));
        }
        if (type !== 'all') list = list.filter(w => w.type === type);
        if (status !== 'all') list = list.filter(w => w.status === status);
        if (priority !== 'all') list = list.filter(w => w.priority === priority);

        list.sort((a, b) => {
            const ad = a.planned_start_date ? new Date(a.planned_start_date).getTime() : 0;
            const bd = b.planned_start_date ? new Date(b.planned_start_date).getTime() : 0;
            return bd - ad;
        });

        return list;
    }, [wos, filters]);

    // ── Audit helper ─────────────────────────────────────────
    const logAudit = useCallback((entry: Omit<AuditEntry, 'id' | 'timestamp' | 'user'>) => {
        setAuditLog(prev => [{
            ...entry,
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            user: 'Current User',
        }, ...prev]);
    }, []);

    // ═════════════════════════════════════════════════════════
    //  WORK ORDER MUTATIONS
    // ═════════════════════════════════════════════════════════

    /** Create WO (Rule 6: taxonomy validation) */
    const createWorkOrder = useCallback((data: {
        type: WorkType; title: string; description: string; assetId: string;
        priority: WorkPriority; plannedStart: string | null; plannedFinish: string | null;
        leadCraft: string; estimatedHours: number;
    }) => {
        const asset = MOCK_ASSETS.find(a => a.id === data.assetId);
        if (!asset) return { error: 'Asset not found' };

        // Rule 6: Taxonomy level validation
        const validLevels = ['equipment', 'subunit', 'component', 'maintainable_item'];
        const level = (asset as any).taxonomy_level || 'equipment';
        if (!validLevels.includes(level)) {
            return { error: 'WO must target Equipment (L6) or below. System-level assets are not valid targets.' };
        }

        const now = new Date().toISOString();
        const newWO: WorkOrder = {
            id: `wo-${Date.now()}`,
            wo_number: `WO-2024-${Math.floor(Math.random() * 9000) + 1000}`,
            type: data.type,
            title: data.title,
            description: data.description,
            status: 'draft',
            priority: data.priority,
            asset_id: data.assetId,
            planned_start_date: data.plannedStart,
            planned_finish_date: data.plannedFinish,
            actual_start_date: null,
            actual_finish_date: null,
            assigned_crew: null,
            lead_craft: data.leadCraft,
            estimated_hours: data.estimatedHours,
            actual_hours: 0,
            failure_coding: null,
            costs: { labor: 0, material: 0, services: 0, total: 0 },
            created_at: now,
            updated_at: now,
        };

        setWos(prev => [newWO, ...prev]);
        logAudit({ action: 'create', entity_type: 'wo', entity_id: newWO.id });
        return { wo: newWO };
    }, [logAudit]);

    /** Update WO (Rule 1: status gates, Rule 2: TECO failure coding, Rule 4: cost lock) */
    const updateWorkOrder = useCallback((id: string, patch: Partial<WorkOrder>) => {
        setWos(prev => prev.map(wo => {
            if (wo.id !== id) return wo;

            // Rule 4: Cost lock on closed WOs
            if (wo.status === 'closed') {
                return wo; // immutable
            }

            // Rule 1: Status gate validation
            if (patch.status && patch.status !== wo.status) {
                const allowed = WO_STATUS_FLOW[wo.status];
                if (!allowed.includes(patch.status)) {
                    return wo; // invalid transition blocked
                }

                // Rule 2: TECO requires failure coding
                if (patch.status === 'teco') {
                    const fc = patch.failure_coding || wo.failure_coding;
                    if (!fc || !fc.failure_mode || !fc.failure_cause || !fc.remedy) {
                        return wo; // blocked — failure coding incomplete
                    }
                }
            }

            const updated = { ...wo, ...patch, updated_at: new Date().toISOString() };

            // Recalculate cost total
            if (patch.costs) {
                updated.costs = {
                    ...wo.costs,
                    ...patch.costs,
                    total: (patch.costs.labor ?? wo.costs.labor) +
                        (patch.costs.material ?? wo.costs.material) +
                        (patch.costs.services ?? wo.costs.services),
                };
            }

            return updated;
        }));

        // Log each changed field
        Object.keys(patch).forEach(field => {
            logAudit({ action: patch.status ? 'status_change' : 'update', entity_type: 'wo', entity_id: id, field });
        });
    }, [logAudit]);

    /** Delete WO (Rule 8: draft-only) */
    const deleteWorkOrder = useCallback((id: string) => {
        const wo = wos.find(w => w.id === id);
        if (!wo || wo.status !== 'draft') return { error: 'Only draft Work Orders can be deleted.' };
        setWos(prev => prev.filter(w => w.id !== id));
        logAudit({ action: 'delete', entity_type: 'wo', entity_id: id });
        return { success: true };
    }, [wos, logAudit]);

    // ═════════════════════════════════════════════════════════
    //  WORK REQUEST MUTATIONS
    // ═════════════════════════════════════════════════════════

    const approveWorkRequest = useCallback((wrId: string) => {
        setWrs(prev => prev.map(w => w.id === wrId ? { ...w, status: 'approved' } : w));
        logAudit({ action: 'status_change', entity_type: 'wr', entity_id: wrId, field: 'status', new_value: 'approved' });
    }, [logAudit]);

    /** Rule 3: Gatekeeper protocol for Criticality A */
    const rejectWorkRequest = useCallback((wrId: string, reason: string, signoff: string) => {
        const wr = wrs.find(w => w.id === wrId);
        if (wr && wr.criticality === 'A' && (!reason || !signoff)) {
            return { error: 'Criticality A assets require rejection reason and gatekeeper sign-off.' };
        }
        setWrs(prev => prev.map(w => w.id === wrId ? { ...w, status: 'rejected', rejection_reason: reason, gatekeeper_signoff: signoff } : w));
        logAudit({ action: 'status_change', entity_type: 'wr', entity_id: wrId, field: 'status', new_value: 'rejected' });
    }, [wrs, logAudit]);

    /** Create WR with auto-RPN (Rule 5) */
    const createWorkRequest = useCallback((title: string, desc: string, assetId: string, sev: number, priority: WorkPriority) => {
        const asset = MOCK_ASSETS.find(a => a.id === assetId);
        if (!asset) return;

        const critMap = { 'A': 5, 'B': 3, 'C': 1 };
        const critMultiplier = critMap[asset.criticality] || 1;
        const autoRPN = critMultiplier * sev;

        // Rule 5: Auto-escalate to emergency if RPN >= 15
        const autoPriority = autoRPN >= 15 ? 'emergency' : priority;

        const newWr: WorkRequest = {
            id: `wr-${Date.now()}`,
            wr_number: `WR-2024-${Math.floor(Math.random() * 9000) + 1000}`,
            title, description: desc, requester: 'Current User',
            created_at: new Date().toISOString(),
            asset_id: asset.id, taxonomy_level: 'equipment',
            criticality: asset.criticality, priority: autoPriority,
            severity_rating: sev, rpn: autoRPN, status: 'draft',
        };
        setWrs(prev => [newWr, ...prev]);
        logAudit({ action: 'create', entity_type: 'wr', entity_id: newWr.id });
        return newWr;
    }, [logAudit]);

    /** Update WR */
    const updateWorkRequest = useCallback((id: string, patch: Partial<WorkRequest>) => {
        setWrs(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
        logAudit({ action: 'update', entity_type: 'wr', entity_id: id });
    }, [logAudit]);

    /** Delete WR (Rule 8: draft-only, Rule 3: Crit A gatekeeper) */
    const deleteWorkRequest = useCallback((id: string) => {
        const wr = wrs.find(w => w.id === id);
        if (!wr || wr.status !== 'draft') return { error: 'Only draft Work Requests can be deleted.' };
        setWrs(prev => prev.filter(w => w.id !== id));
        logAudit({ action: 'delete', entity_type: 'wr', entity_id: id });
        return { success: true };
    }, [wrs, logAudit]);

    /** TECO with mandatory failure coding (Rule 2) */
    const tecoWorkOrder = useCallback((woId: string, fc: WorkOrder['failure_coding']) => {
        if (!fc || !fc.failure_mode || !fc.failure_cause || !fc.remedy) {
            return { error: 'Failure coding (mode, cause, remedy) is mandatory for TECO.' };
        }
        setWos(prev => prev.map(w => {
            if (w.id !== woId) return w;
            const updated = { ...w, status: 'teco' as const, failure_coding: fc, updated_at: new Date().toISOString() };

            // DE Auto-Advancement: if this WO is linked to a DE task, check if DE should advance
            const deTaskId = (w as any).properties?.de_task_id;
            if (deTaskId) {
                import('../eam/services/AnalyzeService').then(({ analyzeService }) => {
                    analyzeService.checkAndAdvanceDEStatus(deTaskId).then(advanced => {
                        if (advanced) {
                            console.log(`[TECO→DE] WO ${w.wo_number} TECO triggered DE task ${deTaskId} status advancement.`);
                        }
                    }).catch(console.error);
                }).catch(console.error);
            }

            return updated;
        }));
        logAudit({ action: 'status_change', entity_type: 'wo', entity_id: woId, field: 'status', new_value: 'teco' });
    }, [logAudit]);

    return {
        wos: filteredWOs,
        allWos: wos,
        wrs,
        summary,
        filters,
        setFilters,
        auditLog,
        // WO mutations
        createWorkOrder,
        updateWorkOrder,
        deleteWorkOrder,
        tecoWorkOrder,
        // WR mutations
        approveWorkRequest,
        rejectWorkRequest,
        createWorkRequest,
        updateWorkRequest,
        deleteWorkRequest,
    };
}
